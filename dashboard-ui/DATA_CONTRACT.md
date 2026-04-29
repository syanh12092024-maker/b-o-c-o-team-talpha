# DATA CONTRACT — Frontend Dashboard

> **GEMINI 3 PRO: READ THIS FIRST**
> This file defines the allowed data sources for the Next.js dashboard.
> **DO NOT** modify the SQL files. **DO NOT** run queries outside this list.

## 1. Allowed Views (ReadOnly)
These views are optimized for dashboard performance. Query them directly via `src/lib/bigquery.ts`.

| View Name | Description | Key Columns |
|-----------|-------------|-------------|
| `STRAMARK_Dataset.vw_fact_orders` | **Orders & Attribution**<br>Source of truth for order status, revenue, and ad attribution. | `order_date`, `status`, `revenue_vnd`, `marketer_name`, `utm_source`, `ad_id` |
| `STRAMARK_Dataset.mart_performance_master` | **Marketing Performance**<br>Aggregated KPIs (Spend, ROAS, Diagnosis). Pre-calculated. | `report_date`, `marketer_name`, `ads_spend_ron`, `revenue_success`, `ROAS`, `diagnosis` (Kill/Scale) |
| `STRAMARK_Dataset.mart_product_insights` | **Product Metrics**<br>Product-level revenue, COGS, margin. | `product_name`, `quantity_sold`, `revenue_ron`, `cogs_total`, `gross_margin_percent` |
| `STRAMARK_Dataset.vw_fact_daily_pnl_v2` | **P&L Daily**<br>Daily profit & loss breakdown. | `report_date`, `total_revenue`, `total_cogs`, `total_ads_spend`, `net_profit` |
| `STRAMARK_Dataset.fact_order_items_dedup` | **Order Items**<br>Line-item details for baskets. | `order_id`, `product_name`, `quantity`, `unit_price`, `cogs` |

## 2. Forbidden Actions
- ❌ **NO INSERT / UPDATE / DELETE** statements.
- ❌ **NO CREATE TABLE / DROP TABLE**.
- ❌ **NO Accessing raw tables** (`sale_order`, `fb_ads_data`) unless absolutely necessary (prefer views).

## 3. Recommended Query Patterns

### Period Filtering
Always filter by `report_date` or `order_date` to optimize query costs.
```sql
WHERE report_date BETWEEN @startDate AND @endDate
```

### Aggregation
Aggregate in SQL, not in Frontend, for best performance.
```sql
SELECT marketer_name, SUM(revenue_success) as revenue
FROM ...
GROUP BY 1
```
