const express = require('express');
const path = require('path');
const db = require('./database');
const queries = require('./queries');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize DB and start server
db.initDb();
db.checkConnection()
  .then(connected => {
    if (!connected) {
      console.error('CRITICAL: Database connection could not be established.');
    }
  });

// Extract filters from request query parameters
function parseFilters(req) {
  return {
    startDate: req.query.startDate || null,
    endDate: req.query.endDate || null,
    category: req.query.category || null,
    region: req.query.region || null,
    segment: req.query.segment || null
  };
}

// Global API Helper for query execution
async function runQuery(res, queryBuilderFn, filters) {
  try {
    const dbType = process.env.DB_TYPE || 'postgres';
    const { queryText, params } = queryBuilderFn(filters, dbType);
    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows, count: result.rowCount });
  } catch (err) {
    console.error('Database query error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

// 1. KPIs Endpoint
app.get('/api/kpis', async (req, res) => {
  const filters = parseFilters(req);
  try {
    const dbType = process.env.DB_TYPE || 'postgres';
    const { queryText, params } = queries.getKpiQuery(filters, dbType);
    const result = await db.query(queryText, params);
    
    // Return first row or defaults
    if (result.rows && result.rows.length > 0) {
      res.json({ success: true, data: result.rows[0] });
    } else {
      res.json({
        success: true,
        data: {
          total_revenue: 0,
          total_orders: 0,
          total_customers: 0,
          avg_order_value: 0,
          total_profit: 0,
          profit_margin_percent: 0
        }
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Charts endpoints
app.get('/api/charts/revenue-trend', (req, res) => {
  runQuery(res, queries.getRevenueTrendQuery, parseFilters(req));
});

app.get('/api/charts/sales-by-category', (req, res) => {
  runQuery(res, queries.getSalesByCategoryQuery, parseFilters(req));
});

app.get('/api/charts/regional-sales', (req, res) => {
  runQuery(res, queries.getRegionalSalesQuery, parseFilters(req));
});

app.get('/api/charts/top-products', (req, res) => {
  runQuery(res, queries.getTopProductsQuery, parseFilters(req));
});

app.get('/api/charts/customer-growth', (req, res) => {
  runQuery(res, queries.getCustomerGrowthQuery, parseFilters(req));
});

app.get('/api/charts/gender-distribution', (req, res) => {
  runQuery(res, queries.getGenderDistributionQuery, parseFilters(req));
});

app.get('/api/charts/customer-segmentation', (req, res) => {
  runQuery(res, queries.getCustomerSegmentationQuery, parseFilters(req));
});

app.get('/api/charts/top-customers-table', (req, res) => {
  runQuery(res, queries.getTopCustomersTableQuery, parseFilters(req));
});

app.get('/api/charts/customer-ltv', (req, res) => {
  runQuery(res, queries.getCustomerLtvQuery, parseFilters(req));
});

app.get('/api/charts/product-matrix', (req, res) => {
  runQuery(res, queries.getProductMatrixQuery, parseFilters(req));
});

app.get('/api/charts/category-treemap', (req, res) => {
  runQuery(res, queries.getCategoryTreemapQuery, parseFilters(req));
});

app.get('/api/charts/product-profitability', (req, res) => {
  runQuery(res, queries.getProductProfitabilityQuery, parseFilters(req));
});

app.get('/api/charts/orders-by-status', (req, res) => {
  runQuery(res, queries.getOrdersByStatusQuery, parseFilters(req));
});

app.get('/api/charts/return-rate', (req, res) => {
  runQuery(res, queries.getReturnRateQuery, parseFilters(req));
});

app.get('/api/charts/cancellation-rate', (req, res) => {
  runQuery(res, queries.getCancellationQuery, parseFilters(req));
});

// 3. Dynamic Insights Engine Endpoint
app.get('/api/insights', async (req, res) => {
  const filters = parseFilters(req);
  const dbType = process.env.DB_TYPE || 'postgres';
  const insights = [];

  try {
    // A. Revenue contribution of categories
    const catQuery = queries.getSalesByCategoryQuery(filters, dbType);
    const catResult = await db.query(catQuery.queryText, catQuery.params);
    const categories = catResult.rows;

    let totalRevenue = 0;
    categories.forEach(c => totalRevenue += parseFloat(c.revenue || 0));

    if (categories.length > 0 && totalRevenue > 0) {
      const topCat = categories[0];
      const topPct = ((parseFloat(topCat.revenue) / totalRevenue) * 100).toFixed(1);
      insights.push({
        type: 'success',
        text: `**${topCat.category}** is the dominant category, contributing **${topPct}%** of total sales ($${parseFloat(topCat.revenue).toLocaleString(undefined, {maximumFractionDigits:0})}).`
      });
    }

    // B. Regional Performance
    const regQuery = queries.getRegionalSalesQuery(filters, dbType);
    const regResult = await db.query(regQuery.queryText, regQuery.params);
    const regions = regResult.rows;

    if (regions.length > 0) {
      const topRegion = regions[0];
      insights.push({
        type: 'info',
        text: `**${topRegion.state} (${topRegion.country})** is the highest generating territory, with sales totaling **$${parseFloat(topRegion.revenue).toLocaleString(undefined, {maximumFractionDigits:0})}**.`
      });
    }

    // C. Profitability warnings
    const profQuery = queries.getProductProfitabilityQuery(filters, dbType);
    const profResult = await db.query(profQuery.queryText, profQuery.params);
    const products = profResult.rows;

    // Filter to find niche or high volume/low margin segments
    const lowMarginCount = products.filter(p => p.profitability_segment && p.profitability_segment.includes('Low Margin')).length;
    if (lowMarginCount > 0) {
      const sampleProd = products.find(p => p.profitability_segment && p.profitability_segment.includes('Low Margin'));
      insights.push({
        type: 'warning',
        text: `Potential margin leak: **${lowMarginCount}** high-revenue products exhibit sub-optimal profitability. For example, **${sampleProd.product_name}** has low margin (**${parseFloat(sampleProd.margin_percent).toFixed(1)}%**).`
      });
    }

    // D. Returns and Cancellations
    const retQuery = queries.getReturnRateQuery(filters, dbType);
    const retResult = await db.query(retQuery.queryText, retQuery.params);
    const returnRates = retResult.rows;

    if (returnRates.length > 0) {
      const maxReturnCat = returnRates[0]; // ordered DESC
      if (parseFloat(maxReturnCat.return_rate) > 7.0) {
        insights.push({
          type: 'danger',
          text: `High return rate detected in **${maxReturnCat.category}** category (**${parseFloat(maxReturnCat.return_rate).toFixed(1)}%**). Requires product quality review.`
        });
      }
    }

    // E. Segment Insights
    const segQuery = queries.getCustomerSegmentationQuery(filters, dbType);
    const segResult = await db.query(segQuery.queryText, segQuery.params);
    const segments = segResult.rows;

    const platSegment = segments.find(s => s.segment === 'Platinum');
    const bronzeSegment = segments.find(s => s.segment === 'Bronze');
    const totalCustCount = segments.reduce((sum, s) => sum + parseInt(s.customer_count), 0);

    if (platSegment && totalCustCount > 0) {
      const platPct = ((parseInt(platSegment.customer_count) / totalCustCount) * 100).toFixed(1);
      const platRevPct = ((parseFloat(platSegment.total_revenue) / totalRevenue) * 100).toFixed(1);
      insights.push({
        type: 'success',
        text: `Customer loyalty: **Platinum** segment makes up only **${platPct}%** of active users but generates **${platRevPct}%** of total sales.`
      });
    }

    if (bronzeSegment && totalCustCount > 0) {
      const bronzePct = ((parseInt(bronzeSegment.customer_count) / totalCustCount) * 100).toFixed(1);
      if (parseFloat(bronzePct) > 30) {
        insights.push({
          type: 'warning',
          text: `Churn warning: **Bronze** customers constitute **${bronzePct}%** of your base. Consider target-marketing campaigns to increase purchasing frequency.`
        });
      }
    }

    res.json({ success: true, data: insights });
  } catch (err) {
    console.error('Insights generation error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper to replace parameters with literal values for SQL console display
function formatQueryWithLiterals(queryObject, dbType) {
  const { queryText, params } = queryObject;
  const isPostgres = dbType === 'postgres';
  let formattedSql = queryText.trim();
  
  if (isPostgres) {
    // Replace $1, $2, ... with corresponding values in reverse order
    for (let i = params.length; i >= 1; i--) {
      const val = params[i - 1];
      const literal = typeof val === 'number' ? val : `'${val}'`;
      formattedSql = formattedSql.split(`$${i}`).join(literal);
    }
  } else {
    // Replace ? in SQLite sequentially
    params.forEach(val => {
      const literal = typeof val === 'number' ? val : `'${val}'`;
      formattedSql = formattedSql.replace('?', literal);
    });
  }
  return formattedSql;
}

// 4. SQL Viewer Endpoints
// Expose the raw queries registry so the client can show them in dropdown
app.get('/api/sql/queries', (req, res) => {
  const dbType = process.env.DB_TYPE || 'postgres';
  const dummyFilters = { startDate: '2022-01-01', endDate: '2026-05-31' };
  
  // Return the query texts for showcase
  const queryRegistry = [
    {
      name: 'Monthly Revenue Trends',
      description: 'Find monthly sales volume, revenue, and gross profit margins.',
      sql: formatQueryWithLiterals(queries.getRevenueTrendQuery(dummyFilters, dbType), dbType)
    },
    {
      name: 'RFM Customer Segmentation',
      description: 'Uses NTILE window function to bucket customers into RFM tiers (Platinum, Gold, Silver, Bronze) based on recency, frequency, and monetary metrics.',
      sql: formatQueryWithLiterals(queries.getCustomerSegmentationQuery(dummyFilters, dbType), dbType)
    },
    {
      name: 'Product Profitability Analysis',
      description: 'Calculates percentiles of product revenues and margin percentages using window functions, grouping items into niche vs volume segments.',
      sql: formatQueryWithLiterals(queries.getProductProfitabilityQuery(dummyFilters, dbType), dbType)
    },
    {
      name: 'Regional Sales breakdown',
      description: 'Ranks geographic states/countries based on aggregated revenues and customer counts.',
      sql: formatQueryWithLiterals(queries.getRegionalSalesQuery(dummyFilters, dbType), dbType)
    },
    {
      name: 'Top Valuable Customers',
      description: 'List of top 15 customers including total orders, total revenue, average order value, and their calculated RFM segment.',
      sql: formatQueryWithLiterals(queries.getTopCustomersTableQuery(dummyFilters, dbType), dbType)
    },
    {
      name: 'Cohort Customer Lifetime Value',
      description: 'Tracks customer cohorts based on signup month, and calculates cumulative spending intervals (Month 0, Months 1-3, Months 4-6, etc.) to estimate LTV.',
      sql: formatQueryWithLiterals(queries.getCustomerLtvQuery(dummyFilters, dbType), dbType)
    }
  ];

  res.json({ success: true, data: queryRegistry });
});

// Run custom query endpoint (RESTRICTED to SELECT/WITH queries for read-only safety)
app.post('/api/sql/run', async (req, res) => {
  const { sql } = req.body;
  if (!sql) {
    return res.status(400).json({ success: false, error: 'Query string is required.' });
  }

  const cleanSql = sql.trim();
  const isReadOnly = /^(select|with|show|pragma|explain)/i.test(cleanSql);
  const containsWriteKeywords = /delete|insert|update|drop|truncate|alter|create|replace/i.test(cleanSql);

  if (!isReadOnly || containsWriteKeywords) {
    return res.status(403).json({
      success: false,
      error: 'Security Warning: Only SELECT, WITH, and EXPLAIN read-only queries are allowed in this dashboard console.'
    });
  }

  try {
    const result = await db.query(sql);
    
    // Extract headers
    let headers = [];
    if (result.rows && result.rows.length > 0) {
      headers = Object.keys(result.rows[0]);
    }

    res.json({
      success: true,
      headers,
      rows: result.rows,
      rowCount: result.rowCount
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Run seeding route for manual trigger
app.post('/api/db/seed', async (req, res) => {
  try {
    await db.setupSchema();
    await db.seedDatabase();
    res.json({ success: true, message: 'Database seeded successfully with 10k customers, 2k products, 100k orders.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Catch-all route to serve the SPA frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(` E-Commerce Analytics Web Server started!          `);
  console.log(` Port: ${PORT}                                      `);
  console.log(` Mode: ${process.env.DB_TYPE || 'postgres'}        `);
  console.log(` Live URL: http://localhost:${PORT}                `);
  console.log(`===================================================`);
});
