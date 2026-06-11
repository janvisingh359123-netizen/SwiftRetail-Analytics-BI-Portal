-- =====================================================================
-- E-Commerce Sales Analytics Dashboard - Showcase SQL Queries
-- =====================================================================
-- This file documents the advanced SQL queries utilized by the backend
-- to drive the interactive executive BI dashboard.
--
-- Concepts Demonstrated:
--   - Common Table Expressions (CTEs)
--   - Window Functions & Ranking (NTILE, PERCENT_RANK, ROW_NUMBER)
--   - Multi-Table Joins & Inner/Left Aggregations
--   - Time-series and Cohort Retention Analysis
--   - RFM Customer Segmentation Matrix
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Monthly Revenue, Profit and Margins (Historical Timeline)
-- ---------------------------------------------------------------------
-- Calculates monthly aggregate totals for sales, profits, and overall margin.
-- Used to construct the primary Executive Overview trend line.
SELECT 
    TO_CHAR(o.order_date, 'YYYY-MM') AS period,
    COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS revenue,
    COALESCE(SUM(oi.quantity * (oi.unit_price - p.cost_price)), 0) AS profit,
    CASE 
        WHEN COALESCE(SUM(oi.quantity * oi.unit_price), 0) = 0 THEN 0
        ELSE (COALESCE(SUM(oi.quantity * (oi.unit_price - p.cost_price)), 0) / COALESCE(SUM(oi.quantity * oi.unit_price), 0)) * 100
    END AS profit_margin_percent
FROM orders o
JOIN order_items oi ON o.order_id = oi.order_id
JOIN products p ON oi.product_id = p.product_id
WHERE o.order_status != 'Cancelled'
GROUP BY TO_CHAR(o.order_date, 'YYYY-MM')
ORDER BY period ASC;


-- ---------------------------------------------------------------------
-- 2. RFM (Recency, Frequency, Monetary) Customer Segmentation
-- ---------------------------------------------------------------------
-- Ranks and segments customers into Platinum, Gold, Silver, and Bronze
-- tiers based on their buying habits using the NTILE window function.
--
-- Definitions:
--   - Recency: Days since last purchase (relative to benchmark date '2026-06-01').
--   - Frequency: Total distinct order count.
--   - Monetary: Total cumulative spending on the platform.
WITH customer_rfm AS (
    SELECT 
        c.customer_id,
        c.first_name || ' ' || c.last_name AS customer_name,
        c.email,
        -- Calculate days elapsed since customer's last order date
        COALESCE(CAST(EXTRACT(EPOCH FROM (CAST('2026-06-01' AS DATE) - o.order_date))/86400 AS INT), 9999) AS recency,
        COUNT(DISTINCT o.order_id) AS frequency,
        COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS monetary
    FROM customers c
    LEFT JOIN orders o ON c.customer_id = o.customer_id AND o.order_status != 'Cancelled'
    LEFT JOIN order_items oi ON o.order_id = oi.order_id
    GROUP BY c.customer_id, c.first_name, c.last_name, c.email
),
rfm_scores AS (
    SELECT 
        *,
        -- Bucket columns into quartiles (1 = best, 4 = worst for recency; 1 = best for freq/monetary)
        NTILE(4) OVER (ORDER BY recency ASC) AS r_score,
        NTILE(4) OVER (ORDER BY frequency DESC) AS f_score,
        NTILE(4) OVER (ORDER BY monetary DESC) AS m_score
    FROM customer_rfm
),
rfm_segments AS (
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
)
SELECT 
    segment,
    COUNT(customer_id) AS customer_count,
    COALESCE(SUM(monetary), 0) AS total_revenue,
    COALESCE(AVG(monetary), 0) AS avg_monetary,
    COALESCE(AVG(frequency), 0) AS avg_frequency
FROM rfm_segments
GROUP BY segment
ORDER BY total_revenue DESC;


-- ---------------------------------------------------------------------
-- 3. Top 15 Customer Portfolio Leaderboard
-- ---------------------------------------------------------------------
-- Identifies top spenders with dynamic location details and details their RFM segment classification.
WITH customer_rfm AS (
    SELECT 
        c.customer_id,
        c.first_name || ' ' || c.last_name AS customer_name,
        c.email,
        c.city,
        c.state,
        c.country,
        COALESCE(CAST(EXTRACT(EPOCH FROM (CAST('2026-06-01' AS DATE) - o.order_date))/86400 AS INT), 9999) AS recency,
        COUNT(DISTINCT o.order_id) AS frequency,
        COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS monetary
    FROM customers c
    LEFT JOIN orders o ON c.customer_id = o.customer_id AND o.order_status != 'Cancelled'
    LEFT JOIN order_items oi ON o.order_id = oi.order_id
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
    state || ', ' || country AS location,
    frequency AS total_orders,
    monetary AS total_revenue,
    CASE WHEN frequency = 0 THEN 0 ELSE monetary / frequency END AS avg_order_value,
    segment
FROM rfm_segments
ORDER BY monetary DESC
LIMIT 15;


-- ---------------------------------------------------------------------
-- 4. Product Profitability Segmentation
-- ---------------------------------------------------------------------
-- Evaluates gross margin versus total revenues. Uses PERCENT_RANK()
-- to classify products into strategic business buckets (Star, Volume, Niche).
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
    WHERE o.order_status != 'Cancelled'
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
LIMIT 30;


-- ---------------------------------------------------------------------
-- 5. Customer Lifetime Value (LTV Cohort Analysis)
-- ---------------------------------------------------------------------
-- Groups customers by signup month and aggregates their purchases across
-- subsequent months (lifespans) to show cohort lifetime expenditure averages.
WITH customer_cohorts AS (
    SELECT 
        customer_id,
        TO_CHAR(signup_date, 'YYYY-MM') AS cohort_month
    FROM customers
),
order_revenues AS (
    SELECT 
        o.customer_id,
        o.order_date,
        SUM(oi.quantity * oi.unit_price) AS order_revenue
    FROM orders o
    JOIN order_items oi ON o.order_id = oi.order_id
    WHERE o.order_status != 'Cancelled'
    GROUP BY o.customer_id, o.order_date
),
cohort_revenue_timeline AS (
    SELECT 
        cc.cohort_month,
        cc.customer_id,
        r.order_date,
        r.order_revenue,
        -- Calculate lifespan months (difference in months)
        CAST(EXTRACT(YEAR FROM r.order_date) - EXTRACT(YEAR FROM TO_DATE(cc.cohort_month || '-01', 'YYYY-MM-DD')) AS INT) * 12 + 
        CAST(EXTRACT(MONTH FROM r.order_date) - EXTRACT(MONTH FROM TO_DATE(cc.cohort_month || '-01', 'YYYY-MM-DD')) AS INT) AS months_active
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
LIMIT 12;
