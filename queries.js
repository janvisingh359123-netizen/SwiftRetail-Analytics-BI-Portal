// E-Commerce Sales Analytics - Core Queries Registry
// Contains advanced SQL queries with CTEs, window functions, ranking, joins, and aggregates.
// Supports both PostgreSQL and SQLite fallback syntaxes.

// Helper to check database type and return appropriate functions
function getSqlDialect(dbType) {
  const isPostgres = dbType === 'postgres';
  return {
    dateFormat: (col, format) => {
      if (isPostgres) {
        return `TO_CHAR(${col}, '${format}')`;
      } else {
        // SQLite equivalent for YYYY-MM
        if (format === 'YYYY-MM') return `strftime('%Y-%m', ${col})`;
        if (format === 'YYYY') return `strftime('%Y', ${col})`;
        return `substr(${col}, 1, 10)`;
      }
    },
    daysBetween: (date1, date2) => {
      if (isPostgres) {
        return `CAST(${date1} - ${date2} AS INT)`;
      } else {
        return `CAST(julianday(${date1}) - julianday(${date2}) AS INT)`;
      }
    },
    concat: (field1, field2) => {
      if (isPostgres) {
        return `${field1} || ' ' || ${field2}`;
      } else {
        return `${field1} || ' ' || ${field2}`;
      }
    }
  };
}

// Build dynamic WHERE clause based on filters
function buildWhereClause(filters, dbType) {
  const conditions = [];
  const params = [];
  let paramCount = 1;
  const isPostgres = dbType === 'postgres';
  const placeholder = () => isPostgres ? `$${paramCount++}` : `?`;

  // Date Filters
  if (filters.startDate) {
    conditions.push(`o.order_date >= ${placeholder()}`);
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    conditions.push(`o.order_date <= ${placeholder()}`);
    params.push(filters.endDate);
  }

  // Category Filter
  if (filters.category) {
    conditions.push(`p.category = ${placeholder()}`);
    params.push(filters.category);
  }

  // Region Filter (Country or State)
  if (filters.region) {
    conditions.push(`(c.country = ${placeholder()} OR c.state = ${placeholder()})`);
    // Push region twice for OR condition in params
    params.push(filters.region, filters.region);
    // Since placeholder is incremented inside function, we make sure it works for both $1/$2 or ?/?
    if (isPostgres) paramCount++; // adjust count for second placeholder
  }

  // Segment Filter (handled separately in CTE join)
  const whereSql = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
  return { whereSql, params, nextParamIdx: paramCount };
}

// 1. Core KPIs Query
function getKpiQuery(filters, dbType) {
  const dialect = getSqlDialect(dbType);
  const { whereSql, params, nextParamIdx } = buildWhereClause(filters, dbType);
  let segmentJoin = '';
  let segmentWhere = '';
  const finalParams = [...params];

  if (filters.segment) {
    const placeholder = dbType === 'postgres' ? `$${nextParamIdx}` : `?`;
    segmentJoin = `JOIN (${getCustomerSegmentationBaseQuery(dbType)}) cs ON o.customer_id = cs.customer_id`;
    segmentWhere = ` AND cs.segment = ${placeholder}`;
    finalParams.push(filters.segment);
  }

  const queryText = `
    SELECT 
      COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS total_revenue,
      COUNT(DISTINCT o.order_id) AS total_orders,
      COUNT(DISTINCT o.customer_id) AS total_customers,
      CASE 
        WHEN COUNT(DISTINCT o.order_id) = 0 THEN 0
        ELSE COALESCE(SUM(oi.quantity * oi.unit_price), 0) / COUNT(DISTINCT o.order_id)
      END AS avg_order_value,
      COALESCE(SUM(oi.quantity * (oi.unit_price - p.cost_price)), 0) AS total_profit,
      CASE 
        WHEN COALESCE(SUM(oi.quantity * oi.unit_price), 0) = 0 THEN 0
        ELSE (COALESCE(SUM(oi.quantity * (oi.unit_price - p.cost_price)), 0) / COALESCE(SUM(oi.quantity * oi.unit_price), 0)) * 100
      END AS profit_margin_percent
    FROM orders o
    JOIN order_items oi ON o.order_id = oi.order_id
    JOIN products p ON oi.product_id = p.product_id
    JOIN customers c ON o.customer_id = c.customer_id
    ${segmentJoin}
    WHERE o.order_status != 'Cancelled' ${whereSql} ${segmentWhere}
  `;

  return { queryText, params: finalParams };
}

// Helper base query for dynamic RFM Customer Segmentation
function getCustomerSegmentationBaseQuery(dbType) {
  const isPostgres = dbType === 'postgres';
  const recencyCalc = isPostgres 
    ? "CAST(EXTRACT(EPOCH FROM (CAST('2026-06-01' AS DATE) - o.order_date))/86400 AS INT)"
    : "CAST(julianday('2026-06-01') - julianday(o.order_date) AS INT)";

  return `
    WITH customer_rfm AS (
      SELECT 
        c.customer_id,
        c.first_name || ' ' || c.last_name AS customer_name,
        c.email,
        c.gender,
        c.city,
        c.state,
        c.country,
        c.signup_date,
        COALESCE(MIN(${recencyCalc}), 9999) AS recency,
        COUNT(DISTINCT o.order_id) AS frequency,
        COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS monetary
      FROM customers c
      LEFT JOIN orders o ON c.customer_id = o.customer_id AND o.order_status != 'Cancelled'
      LEFT JOIN order_items oi ON o.order_id = oi.order_id
      GROUP BY c.customer_id, c.first_name, c.last_name, c.email, c.gender, c.city, c.state, c.country, c.signup_date
    ),
    rfm_scores AS (
      SELECT 
        *,
        NTILE(4) OVER (ORDER BY recency ASC) AS r_score,
        NTILE(4) OVER (ORDER BY frequency DESC) AS f_score,
        NTILE(4) OVER (ORDER BY monetary DESC) AS m_score
      FROM customer_rfm
    )
    SELECT 
      *,
      (r_score + f_score + m_score) AS total_score,
      CASE 
        WHEN (r_score + f_score + m_score) <= 5 THEN 'Platinum'
        WHEN (r_score + f_score + m_score) <= 8 THEN 'Gold'
        WHEN (r_score + f_score + m_score) <= 10 THEN 'Silver'
        ELSE 'Bronze'
      END AS segment
    FROM rfm_scores
  `;
}

// 2. Revenue Trend Line Chart Query
function getRevenueTrendQuery(filters, dbType) {
  const dialect = getSqlDialect(dbType);
  const { whereSql, params, nextParamIdx } = buildWhereClause(filters, dbType);
  let segmentJoin = '';
  let segmentWhere = '';
  const finalParams = [...params];

  if (filters.segment) {
    const placeholder = dbType === 'postgres' ? `$${nextParamIdx}` : `?`;
    segmentJoin = `JOIN (${getCustomerSegmentationBaseQuery(dbType)}) cs ON o.customer_id = cs.customer_id`;
    segmentWhere = ` AND cs.segment = ${placeholder}`;
    finalParams.push(filters.segment);
  }

  const queryText = `
    SELECT 
      ${dialect.dateFormat('o.order_date', 'YYYY-MM')} AS period,
      COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS revenue,
      COALESCE(SUM(oi.quantity * (oi.unit_price - p.cost_price)), 0) AS profit
    FROM orders o
    JOIN order_items oi ON o.order_id = oi.order_id
    JOIN products p ON oi.product_id = p.product_id
    JOIN customers c ON o.customer_id = c.customer_id
    ${segmentJoin}
    WHERE o.order_status != 'Cancelled' ${whereSql} ${segmentWhere}
    GROUP BY period
    ORDER BY period ASC
  `;

  return { queryText, params: finalParams };
}

// 3. Sales By Category Bar Chart Query
function getSalesByCategoryQuery(filters, dbType) {
  const { whereSql, params, nextParamIdx } = buildWhereClause(filters, dbType);
  let segmentJoin = '';
  let segmentWhere = '';
  const finalParams = [...params];

  if (filters.segment) {
    const placeholder = dbType === 'postgres' ? `$${nextParamIdx}` : `?`;
    segmentJoin = `JOIN (${getCustomerSegmentationBaseQuery(dbType)}) cs ON o.customer_id = cs.customer_id`;
    segmentWhere = ` AND cs.segment = ${placeholder}`;
    finalParams.push(filters.segment);
  }

  const queryText = `
    SELECT 
      p.category,
      COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS revenue,
      COALESCE(SUM(oi.quantity), 0) AS units_sold,
      COUNT(DISTINCT o.order_id) AS total_orders
    FROM orders o
    JOIN order_items oi ON o.order_id = oi.order_id
    JOIN products p ON oi.product_id = p.product_id
    JOIN customers c ON o.customer_id = c.customer_id
    ${segmentJoin}
    WHERE o.order_status != 'Cancelled' ${whereSql} ${segmentWhere}
    GROUP BY p.category
    ORDER BY revenue DESC
  `;

  return { queryText, params: finalParams };
}

// 4. Regional Performance Map / Table Query
function getRegionalSalesQuery(filters, dbType) {
  const { whereSql, params, nextParamIdx } = buildWhereClause(filters, dbType);
  let segmentJoin = '';
  let segmentWhere = '';
  const finalParams = [...params];

  if (filters.segment) {
    const placeholder = dbType === 'postgres' ? `$${nextParamIdx}` : `?`;
    segmentJoin = `JOIN (${getCustomerSegmentationBaseQuery(dbType)}) cs ON o.customer_id = cs.customer_id`;
    segmentWhere = ` AND cs.segment = ${placeholder}`;
    finalParams.push(filters.segment);
  }

  const queryText = `
    SELECT 
      c.country,
      c.state,
      COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS revenue,
      COUNT(DISTINCT o.order_id) AS total_orders,
      COUNT(DISTINCT o.customer_id) AS unique_customers
    FROM orders o
    JOIN order_items oi ON o.order_id = oi.order_id
    JOIN products p ON oi.product_id = p.product_id
    JOIN customers c ON o.customer_id = c.customer_id
    ${segmentJoin}
    WHERE o.order_status != 'Cancelled' ${whereSql} ${segmentWhere}
    GROUP BY c.country, c.state
    ORDER BY revenue DESC
    LIMIT 30
  `;

  return { queryText, params: finalParams };
}

// 5. Top 10 Products Horizontal Bar Query
function getTopProductsQuery(filters, dbType) {
  const { whereSql, params, nextParamIdx } = buildWhereClause(filters, dbType);
  let segmentJoin = '';
  let segmentWhere = '';
  const finalParams = [...params];

  if (filters.segment) {
    const placeholder = dbType === 'postgres' ? `$${nextParamIdx}` : `?`;
    segmentJoin = `JOIN (${getCustomerSegmentationBaseQuery(dbType)}) cs ON o.customer_id = cs.customer_id`;
    segmentWhere = ` AND cs.segment = ${placeholder}`;
    finalParams.push(filters.segment);
  }

  const queryText = `
    SELECT 
      p.product_id,
      p.product_name,
      p.category,
      COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS revenue,
      COALESCE(SUM(oi.quantity), 0) AS units_sold,
      COALESCE(SUM(oi.quantity * (oi.unit_price - p.cost_price)), 0) AS profit
    FROM orders o
    JOIN order_items oi ON o.order_id = oi.order_id
    JOIN products p ON oi.product_id = p.product_id
    JOIN customers c ON o.customer_id = c.customer_id
    ${segmentJoin}
    WHERE o.order_status != 'Cancelled' ${whereSql} ${segmentWhere}
    GROUP BY p.product_id, p.product_name, p.category
    ORDER BY revenue DESC
    LIMIT 10
  `;

  return { queryText, params: finalParams };
}

// 6. Customer Growth Signup trends
function getCustomerGrowthQuery(filters, dbType) {
  const dialect = getSqlDialect(dbType);
  const conditions = [];
  const params = [];
  let paramCount = 1;
  const isPostgres = dbType === 'postgres';
  const placeholder = () => isPostgres ? `$${paramCount++}` : `?`;

  if (filters.startDate) {
    conditions.push(`signup_date >= ${placeholder()}`);
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    conditions.push(`signup_date <= ${placeholder()}`);
    params.push(filters.endDate);
  }
  if (filters.region) {
    conditions.push(`(country = ${placeholder()} OR state = ${placeholder()})`);
    params.push(filters.region, filters.region);
    if (isPostgres) paramCount++;
  }

  const whereSql = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const queryText = `
    SELECT 
      ${dialect.dateFormat('signup_date', 'YYYY-MM')} AS period,
      COUNT(customer_id) AS signups,
      SUM(COUNT(customer_id)) OVER (ORDER BY ${dialect.dateFormat('signup_date', 'YYYY-MM')} ASC) AS cumulative_customers
    FROM customers
    ${whereSql}
    GROUP BY period
    ORDER BY period ASC
  `;

  return { queryText, params };
}

// 7. Gender Distribution
function getGenderDistributionQuery(filters, dbType) {
  const { whereSql, params, nextParamIdx } = buildWhereClause(filters, dbType);
  let segmentJoin = '';
  let segmentWhere = '';
  const finalParams = [...params];

  if (filters.segment) {
    const placeholder = dbType === 'postgres' ? `$${nextParamIdx}` : `?`;
    segmentJoin = `JOIN (${getCustomerSegmentationBaseQuery(dbType)}) cs ON o.customer_id = cs.customer_id`;
    segmentWhere = ` AND cs.segment = ${placeholder}`;
    finalParams.push(filters.segment);
  }

  const queryText = `
    SELECT 
      c.gender,
      COUNT(DISTINCT c.customer_id) AS customer_count,
      COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS total_spend,
      COUNT(DISTINCT o.order_id) AS total_orders
    FROM customers c
    LEFT JOIN orders o ON c.customer_id = o.customer_id AND o.order_status != 'Cancelled'
    LEFT JOIN order_items oi ON o.order_id = oi.order_id
    LEFT JOIN products p ON oi.product_id = p.product_id
    ${segmentJoin}
    WHERE 1=1 ${whereSql} ${segmentWhere}
    GROUP BY c.gender
    ORDER BY customer_count DESC
  `;

  return { queryText, params: finalParams };
}

// 8. RFM Customer Segmentation Distribution Query
function getCustomerSegmentationQuery(filters, dbType) {
  const { whereSql, params } = buildWhereClause(filters, dbType);
  
  // Note: Since filters update base datasets, RFM segmentation is computed dynamically on the filtered customer list!
  // This demonstrates dynamic analytics logic.
  const recencyCalc = dbType === 'postgres' 
    ? "CAST(EXTRACT(EPOCH FROM (CAST('2026-06-01' AS DATE) - o.order_date))/86400 AS INT)"
    : "CAST(julianday('2026-06-01') - julianday(o.order_date) AS INT)";

  // Complete query constructing segment aggregates
  const queryText = `
    WITH customer_rfm AS (
      SELECT 
        c.customer_id,
        c.gender,
        COALESCE(MIN(${recencyCalc}), 9999) AS recency,
        COUNT(DISTINCT o.order_id) AS frequency,
        COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS monetary
      FROM customers c
      LEFT JOIN orders o ON c.customer_id = o.customer_id AND o.order_status != 'Cancelled'
      LEFT JOIN order_items oi ON o.order_id = oi.order_id
      LEFT JOIN products p ON oi.product_id = p.product_id
      WHERE 1=1 ${whereSql}
      GROUP BY c.customer_id, c.gender
    ),
    rfm_scores AS (
      SELECT 
        *,
        NTILE(4) OVER (ORDER BY recency ASC) AS r_score,
        NTILE(4) OVER (ORDER BY frequency DESC) AS f_score,
        NTILE(4) OVER (ORDER BY monetary DESC) AS m_score
      FROM customer_rfm
    ),
    rfm_segments AS (
      SELECT 
        *,
        CASE 
          WHEN (r_score + f_score + m_score) <= 5 THEN 'Platinum'
          WHEN (r_score + f_score + m_score) <= 8 THEN 'Gold'
          WHEN (r_score + f_score + m_score) <= 10 THEN 'Silver'
          ELSE 'Bronze'
        END AS segment
      FROM rfm_scores
    )
    SELECT 
      segment,
      COUNT(customer_id) AS customer_count,
      COALESCE(SUM(monetary), 0) AS total_revenue,
      COALESCE(AVG(monetary), 0) AS avg_monetary,
      COALESCE(AVG(frequency), 0) AS avg_frequency
    FROM rfm_segments
    GROUP BY segment
    ORDER BY total_revenue DESC
  `;

  return { queryText, params };
}

// 9. Top Customers Table Query with RFM Segment details
function getTopCustomersTableQuery(filters, dbType) {
  const { whereSql, params } = buildWhereClause(filters, dbType);
  const recencyCalc = dbType === 'postgres' 
    ? "CAST(EXTRACT(EPOCH FROM (CAST('2026-06-01' AS DATE) - o.order_date))/86400 AS INT)"
    : "CAST(julianday('2026-06-01') - julianday(o.order_date) AS INT)";

  const queryText = `
    WITH customer_rfm AS (
      SELECT 
        c.customer_id,
        c.first_name || ' ' || c.last_name AS customer_name,
        c.email,
        c.city,
        c.state,
        c.country,
        COALESCE(MIN(${recencyCalc}), 9999) AS recency,
        COUNT(DISTINCT o.order_id) AS frequency,
        COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS monetary
      FROM customers c
      LEFT JOIN orders o ON c.customer_id = o.customer_id AND o.order_status != 'Cancelled'
      LEFT JOIN order_items oi ON o.order_id = oi.order_id
      LEFT JOIN products p ON oi.product_id = p.product_id
      WHERE 1=1 ${whereSql}
      GROUP BY c.customer_id, c.first_name, c.last_name, c.email, c.city, c.state, c.country
    ),
    rfm_scores AS (
      SELECT 
        *,
        NTILE(4) OVER (ORDER BY recency ASC) AS r_score,
        NTILE(4) OVER (ORDER BY frequency DESC) AS f_score,
        NTILE(4) OVER (ORDER BY monetary DESC) AS m_score
      FROM customer_rfm
    ),
    rfm_segments AS (
      SELECT 
        *,
        CASE 
          WHEN (r_score + f_score + m_score) <= 5 THEN 'Platinum'
          WHEN (r_score + f_score + m_score) <= 8 THEN 'Gold'
          WHEN (r_score + f_score + m_score) <= 10 THEN 'Silver'
          ELSE 'Bronze'
        END AS segment
      FROM rfm_scores
    )
    SELECT 
      customer_id,
      customer_name,
      email,
      country,
      state,
      frequency AS total_orders,
      monetary AS total_revenue,
      CASE WHEN frequency = 0 THEN 0 ELSE monetary / frequency END AS avg_order_value,
      segment
    FROM rfm_segments
    ORDER BY monetary DESC
    LIMIT 15
  `;

  return { queryText, params };
}

// 10. Customer Lifetime Value (Cohort Cohort Analysis)
function getCustomerLtvQuery(filters, dbType) {
  const dialect = getSqlDialect(dbType);
  const { whereSql, params } = buildWhereClause(filters, dbType);
  
  const queryText = `
    WITH customer_cohorts AS (
      SELECT 
        customer_id,
        ${dialect.dateFormat('signup_date', 'YYYY-MM')} AS cohort_month
      FROM customers
    ),
    order_revenues AS (
      SELECT 
        o.customer_id,
        o.order_date,
        SUM(oi.quantity * oi.unit_price) AS order_revenue
      FROM orders o
      JOIN order_items oi ON o.order_id = oi.order_id
      JOIN products p ON oi.product_id = p.product_id
      WHERE o.order_status != 'Cancelled' ${whereSql}
      GROUP BY o.customer_id, o.order_date
    ),
    cohort_revenue_timeline AS (
      SELECT 
        cc.cohort_month,
        cc.customer_id,
        r.order_date,
        r.order_revenue,
        -- Calculate months since signup
        ${dbType === 'postgres' 
          ? "CAST(EXTRACT(YEAR FROM r.order_date) - EXTRACT(YEAR FROM TO_DATE(cc.cohort_month || '-01', 'YYYY-MM-DD')) AS INT) * 12 + CAST(EXTRACT(MONTH FROM r.order_date) - EXTRACT(MONTH FROM TO_DATE(cc.cohort_month || '-01', 'YYYY-MM-DD')) AS INT)"
          : "CAST(strftime('%Y', r.order_date) - substr(cc.cohort_month, 1, 4) AS INT) * 12 + CAST(strftime('%m', r.order_date) - substr(cc.cohort_month, 6, 2) AS INT)"
        } AS months_active
      FROM customer_cohorts cc
      JOIN order_revenues r ON cc.customer_id = r.customer_id
    )
    SELECT 
      cohort_month,
      COUNT(DISTINCT customer_id) AS cohort_size,
      SUM(CASE WHEN months_active = 0 THEN order_revenue ELSE 0 END) AS month_0_rev,
      SUM(CASE WHEN months_active BETWEEN 1 AND 3 THEN order_revenue ELSE 0 END) AS month_1_3_rev,
      SUM(CASE WHEN months_active BETWEEN 4 AND 6 THEN order_revenue ELSE 0 END) AS month_4_6_rev,
      SUM(CASE WHEN months_active > 6 THEN order_revenue ELSE 0 END) AS month_7plus_rev,
      SUM(order_revenue) AS cumulative_cohort_revenue,
      SUM(order_revenue) / COUNT(DISTINCT customer_id) AS average_ltv
    FROM cohort_revenue_timeline
    GROUP BY cohort_month
    ORDER BY cohort_month ASC
    LIMIT 12
  `;

  return { queryText, params };
}

// 11. Product Performance Matrix (Scatter plot: Qty Sold vs Revenue vs Profit)
function getProductMatrixQuery(filters, dbType) {
  const { whereSql, params, nextParamIdx } = buildWhereClause(filters, dbType);
  let segmentJoin = '';
  let segmentWhere = '';
  const finalParams = [...params];

  if (filters.segment) {
    const placeholder = dbType === 'postgres' ? `$${nextParamIdx}` : `?`;
    segmentJoin = `JOIN (${getCustomerSegmentationBaseQuery(dbType)}) cs ON o.customer_id = cs.customer_id`;
    segmentWhere = ` AND cs.segment = ${placeholder}`;
    finalParams.push(filters.segment);
  }

  const queryText = `
    SELECT 
      p.product_id,
      p.product_name,
      p.category,
      COALESCE(SUM(oi.quantity), 0) AS quantity_sold,
      COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS revenue,
      COALESCE(SUM(oi.quantity * (oi.unit_price - p.cost_price)), 0) AS profit
    FROM orders o
    JOIN order_items oi ON o.order_id = oi.order_id
    JOIN products p ON oi.product_id = p.product_id
    JOIN customers c ON o.customer_id = c.customer_id
    ${segmentJoin}
    WHERE o.order_status != 'Cancelled' ${whereSql} ${segmentWhere}
    GROUP BY p.product_id, p.product_name, p.category
    ORDER BY quantity_sold DESC
    LIMIT 200
  `;

  return { queryText, params: finalParams };
}

// 12. Treemap of Category/Subcategory Revenue Contribution
function getCategoryTreemapQuery(filters, dbType) {
  const { whereSql, params, nextParamIdx } = buildWhereClause(filters, dbType);
  let segmentJoin = '';
  let segmentWhere = '';
  const finalParams = [...params];

  if (filters.segment) {
    const placeholder = dbType === 'postgres' ? `$${nextParamIdx}` : `?`;
    segmentJoin = `JOIN (${getCustomerSegmentationBaseQuery(dbType)}) cs ON o.customer_id = cs.customer_id`;
    segmentWhere = ` AND cs.segment = ${placeholder}`;
    finalParams.push(filters.segment);
  }

  const queryText = `
    SELECT 
      p.category,
      p.subcategory,
      COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS revenue,
      COALESCE(SUM(oi.quantity * (oi.unit_price - p.cost_price)), 0) AS profit
    FROM orders o
    JOIN order_items oi ON o.order_id = oi.order_id
    JOIN products p ON oi.product_id = p.product_id
    JOIN customers c ON o.customer_id = c.customer_id
    ${segmentJoin}
    WHERE o.order_status != 'Cancelled' ${whereSql} ${segmentWhere}
    GROUP BY p.category, p.subcategory
    ORDER BY p.category, revenue DESC
  `;

  return { queryText, params: finalParams };
}

// 13. Product Profitability Analysis (Highlighting Low margin/high volume & High margin/low volume)
function getProductProfitabilityQuery(filters, dbType) {
  const { whereSql, params, nextParamIdx } = buildWhereClause(filters, dbType);
  let segmentJoin = '';
  let segmentWhere = '';
  const finalParams = [...params];

  if (filters.segment) {
    const placeholder = dbType === 'postgres' ? `$${nextParamIdx}` : `?`;
    segmentJoin = `JOIN (${getCustomerSegmentationBaseQuery(dbType)}) cs ON o.customer_id = cs.customer_id`;
    segmentWhere = ` AND cs.segment = ${placeholder}`;
    finalParams.push(filters.segment);
  }

  // Uses Window Functions (Rank/Percent) to identify products in top 20% revenue but bottom 20% margin
  const queryText = `
    WITH product_metrics AS (
      SELECT 
        p.product_id,
        p.product_name,
        p.category,
        COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS revenue,
        COALESCE(SUM(oi.quantity * (oi.unit_price - p.cost_price)), 0) AS profit,
        CASE 
          WHEN COALESCE(SUM(oi.quantity * oi.unit_price), 0) = 0 THEN 0
          ELSE (COALESCE(SUM(oi.quantity * (oi.unit_price - p.cost_price)), 0) / COALESCE(SUM(oi.quantity * oi.unit_price), 0)) * 100
        END AS margin_percent
      FROM orders o
      JOIN order_items oi ON o.order_id = oi.order_id
      JOIN products p ON oi.product_id = p.product_id
      JOIN customers c ON o.customer_id = c.customer_id
      ${segmentJoin}
      WHERE o.order_status != 'Cancelled' ${whereSql} ${segmentWhere}
      GROUP BY p.product_id, p.product_name, p.category
    ),
    ranked_metrics AS (
      SELECT 
        *,
        PERCENT_RANK() OVER (ORDER BY revenue DESC) AS rev_percentile,
        PERCENT_RANK() OVER (ORDER BY margin_percent DESC) AS margin_percentile
      FROM product_metrics
      WHERE revenue > 0
    )
    SELECT 
      product_id,
      product_name,
      category,
      revenue,
      profit,
      margin_percent,
      CASE 
        WHEN rev_percentile <= 0.25 AND margin_percentile >= 0.75 THEN 'High Revenue / Low Margin (Critical Volume)'
        WHEN rev_percentile >= 0.75 AND margin_percentile <= 0.25 THEN 'Low Revenue / High Margin (Niche Profit)'
        WHEN rev_percentile <= 0.25 AND margin_percentile <= 0.25 THEN 'Star Performers (High Revenue & Margin)'
        ELSE 'Standard Performer'
      END AS profitability_segment
    FROM ranked_metrics
    ORDER BY revenue DESC
    LIMIT 30
  `;

  return { queryText, params: finalParams };
}

// 14. Orders by Status
function getOrdersByStatusQuery(filters, dbType) {
  const { whereSql, params } = buildWhereClause(filters, dbType);
  
  // Note: We bypass order_status CHECK in filters base where because we want to count all statuses
  // So we strip order_status conditions if present or construct a direct where filter
  const conditions = [];
  const queryParams = [];
  let paramCount = 1;
  const isPostgres = dbType === 'postgres';
  const placeholder = () => isPostgres ? `$${paramCount++}` : `?`;

  if (filters.startDate) {
    conditions.push(`o.order_date >= ${placeholder()}`);
    queryParams.push(filters.startDate);
  }
  if (filters.endDate) {
    conditions.push(`o.order_date <= ${placeholder()}`);
    queryParams.push(filters.endDate);
  }
  if (filters.category) {
    conditions.push(`p.category = ${placeholder()}`);
    queryParams.push(filters.category);
  }
  if (filters.region) {
    conditions.push(`(c.country = ${placeholder()} OR c.state = ${placeholder()})`);
    queryParams.push(filters.region, filters.region);
    if (isPostgres) paramCount++;
  }

  const customWhereSql = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const queryText = `
    SELECT 
      o.order_status,
      COUNT(DISTINCT o.order_id) AS order_count,
      COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS total_revenue
    FROM orders o
    JOIN order_items oi ON o.order_id = oi.order_id
    JOIN products p ON oi.product_id = p.product_id
    JOIN customers c ON o.customer_id = c.customer_id
    ${customWhereSql}
    GROUP BY o.order_status
    ORDER BY order_count DESC
  `;

  return { queryText, params: queryParams };
}

// 15. Return Rate Analysis
function getReturnRateQuery(filters, dbType) {
  const { whereSql, params, nextParamIdx } = buildWhereClause(filters, dbType);
  let segmentJoin = '';
  let segmentWhere = '';
  const finalParams = [...params];

  if (filters.segment) {
    const placeholder = dbType === 'postgres' ? `$${nextParamIdx}` : `?`;
    segmentJoin = `JOIN (${getCustomerSegmentationBaseQuery(dbType)}) cs ON o.customer_id = cs.customer_id`;
    segmentWhere = ` AND cs.segment = ${placeholder}`;
    finalParams.push(filters.segment);
  }

  const queryText = `
    SELECT 
      p.category,
      COUNT(DISTINCT o.order_id) AS total_orders,
      COUNT(DISTINCT CASE WHEN o.order_status = 'Returned' THEN o.order_id END) AS returned_orders,
      (COUNT(DISTINCT CASE WHEN o.order_status = 'Returned' THEN o.order_id END) * 100.0) / COUNT(DISTINCT o.order_id) AS return_rate
    FROM orders o
    JOIN order_items oi ON o.order_id = oi.order_id
    JOIN products p ON oi.product_id = p.product_id
    JOIN customers c ON o.customer_id = c.customer_id
    ${segmentJoin}
    WHERE 1=1 ${whereSql} ${segmentWhere}
    GROUP BY p.category
    ORDER BY return_rate DESC
  `;

  return { queryText, params: finalParams };
}

// 16. Cancellation Analysis by Product Subcategory
function getCancellationQuery(filters, dbType) {
  const { whereSql, params, nextParamIdx } = buildWhereClause(filters, dbType);
  let segmentJoin = '';
  let segmentWhere = '';
  const finalParams = [...params];

  if (filters.segment) {
    const placeholder = dbType === 'postgres' ? `$${nextParamIdx}` : `?`;
    segmentJoin = `JOIN (${getCustomerSegmentationBaseQuery(dbType)}) cs ON o.customer_id = cs.customer_id`;
    segmentWhere = ` AND cs.segment = ${placeholder}`;
    finalParams.push(filters.segment);
  }

  const queryText = `
    SELECT 
      p.subcategory,
      p.category,
      COUNT(DISTINCT o.order_id) AS total_orders,
      COUNT(DISTINCT CASE WHEN o.order_status = 'Cancelled' THEN o.order_id END) AS cancelled_orders,
      (COUNT(DISTINCT CASE WHEN o.order_status = 'Cancelled' THEN o.order_id END) * 100.0) / COUNT(DISTINCT o.order_id) AS cancellation_rate
    FROM orders o
    JOIN order_items oi ON o.order_id = oi.order_id
    JOIN products p ON oi.product_id = p.product_id
    JOIN customers c ON o.customer_id = c.customer_id
    ${segmentJoin}
    WHERE 1=1 ${whereSql} ${segmentWhere}
    GROUP BY p.category, p.subcategory
    ORDER BY cancellation_rate DESC
    LIMIT 10
  `;

  return { queryText, params: finalParams };
}

module.exports = {
  getKpiQuery,
  getRevenueTrendQuery,
  getSalesByCategoryQuery,
  getRegionalSalesQuery,
  getTopProductsQuery,
  getCustomerGrowthQuery,
  getGenderDistributionQuery,
  getCustomerSegmentationQuery,
  getTopCustomersTableQuery,
  getCustomerLtvQuery,
  getProductMatrixQuery,
  getCategoryTreemapQuery,
  getProductProfitabilityQuery,
  getOrdersByStatusQuery,
  getReturnRateQuery,
  getCancellationQuery,
  getCustomerSegmentationBaseQuery
};
