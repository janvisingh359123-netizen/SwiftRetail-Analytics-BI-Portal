// E-Commerce Sales Analytics - Client Application Controller

// Global State Manager
const state = {
  theme: 'light',
  activeTab: 'executive',
  filters: {
    startDate: '2022-01-01',
    endDate: '2026-05-31',
    category: '',
    region: '',
    segment: ''
  },
  sqlQueries: [],
  charts: {} // Holds active ApexCharts references
};

// Cohesive Corporate Color Palette (Blues, Indigo, Slate)
const colors = {
  primary: '#2563eb',   // Cobalt Blue
  info: '#0ea5e9',      // Steel Blue
  success: '#059669',   // Forest Green
  warning: '#d97706',   // Ochre Amber
  danger: '#dc2626',    // Crimson Red
  gray: '#64748b',      // Slate Gray
  accent1: '#4f46e5',   // Royal Indigo
  accent2: '#0891b2',   // Muted Teal
  chartGradients: ['#2563eb', '#4f46e5', '#0ea5e9', '#0891b2', '#059669', '#d97706']
};

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initNavigation();
  initFilters();
  initSQLConsole();
  initExportAndReport();
  
  // Initial data loading
  refreshDashboard();
});

/* ----------------------------------------------------
   1. Theme Management (Light / Dark)
---------------------------------------------------- */
function initTheme() {
  const toggleBtn = document.getElementById('theme-toggle');
  
  // Check system preferences or storage
  const savedTheme = localStorage.getItem('theme') || 'light';
  setTheme(savedTheme);
  
  toggleBtn.addEventListener('click', () => {
    const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
  });
}

function setTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  
  const toggleBtn = document.getElementById('theme-toggle');
  if (theme === 'light') {
    toggleBtn.innerHTML = '<i class="fa-solid fa-sun"></i> <span>Light Mode</span>';
  } else {
    toggleBtn.innerHTML = '<i class="fa-solid fa-moon"></i> <span>Dark Mode</span>';
  }
  
  // Dynamically update charts themes
  Object.values(state.charts).forEach(chart => {
    if (chart) {
      chart.updateOptions({
        theme: {
          mode: theme
        },
        grid: {
          borderColor: theme === 'dark' ? '#374151' : '#e5e7eb'
        }
      });
    }
  });
}

/* ----------------------------------------------------
   2. Sidebar Navigation Tabs
---------------------------------------------------- */
function initNavigation() {
  const menuItems = document.querySelectorAll('.menu-item');
  
  menuItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      
      const targetTab = item.getAttribute('data-tab');
      if (targetTab === state.activeTab) return;
      
      // Update sidebar state
      menuItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      
      // Update pane visible states
      document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.remove('active');
      });
      
      const targetPane = document.getElementById(`tab-${targetTab}`);
      targetPane.classList.add('active');
      
      state.activeTab = targetTab;
      
      // Re-trigger chart layout sizing (fixes ApexCharts canvas sizing bugs inside hidden tabs)
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
        loadTabSpecificData(targetTab);
      }, 50);
    });
  });
}

/* ----------------------------------------------------
   3. Filters Panels Sync
---------------------------------------------------- */
function initFilters() {
  const applyBtn = document.getElementById('btn-apply-filters');
  const resetBtn = document.getElementById('btn-reset-filters');
  
  // Load initial filter states into HTML input elements
  document.getElementById('filter-start-date').value = state.filters.startDate;
  document.getElementById('filter-end-date').value = state.filters.endDate;
  document.getElementById('filter-category').value = state.filters.category;
  document.getElementById('filter-region').value = state.filters.region;
  document.getElementById('filter-segment').value = state.filters.segment;

  applyBtn.addEventListener('click', () => {
    state.filters.startDate = document.getElementById('filter-start-date').value;
    state.filters.endDate = document.getElementById('filter-end-date').value;
    state.filters.category = document.getElementById('filter-category').value;
    state.filters.region = document.getElementById('filter-region').value;
    state.filters.segment = document.getElementById('filter-segment').value;
    
    refreshDashboard();
  });

  resetBtn.addEventListener('click', () => {
    state.filters = {
      startDate: '2022-01-01',
      endDate: '2026-05-31',
      category: '',
      region: '',
      segment: ''
    };
    
    document.getElementById('filter-start-date').value = state.filters.startDate;
    document.getElementById('filter-end-date').value = state.filters.endDate;
    document.getElementById('filter-category').value = state.filters.category;
    document.getElementById('filter-region').value = state.filters.region;
    document.getElementById('filter-segment').value = state.filters.segment;
    
    refreshDashboard();
  });
}

// Build query parameter string matching current filters
function getFilterQueryParams() {
  const params = new URLSearchParams();
  if (state.filters.startDate) params.append('startDate', state.filters.startDate);
  if (state.filters.endDate) params.append('endDate', state.filters.endDate);
  if (state.filters.category) params.append('category', state.filters.category);
  if (state.filters.region) params.append('region', state.filters.region);
  if (state.filters.segment) params.append('segment', state.filters.segment);
  return params.toString();
}

/* ----------------------------------------------------
   4. API Service & Dashboard Refreshes
---------------------------------------------------- */
async function fetchApi(endpoint) {
  const queryString = getFilterQueryParams();
  const separator = endpoint.includes('?') ? '&' : '?';
  const url = `${endpoint}${separator}${queryString}`;
  
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'API call failed');
    return json.data;
  } catch (err) {
    console.error(`Fetch API Error [${endpoint}]:`, err.message);
    return null;
  }
}

// Refreshes core KPIs + current visible tab
async function refreshDashboard() {
  await loadKpis();
  loadTabSpecificData(state.activeTab);
}

// Load data specifically related to the active dashboard pane
function loadTabSpecificData(tab) {
  if (tab === 'executive') {
    loadExecutiveTab();
  } else if (tab === 'customers') {
    loadCustomersTab();
  } else if (tab === 'products') {
    loadProductsTab();
  } else if (tab === 'orders') {
    loadOrdersTab();
  }
}

// Fetch and set KPIs on top cards
async function loadKpis() {
  const kpis = await fetchApi('/api/kpis');
  if (!kpis) return;
  
  // Animate counters
  animateValue('kpi-revenue', parseFloat(kpis.total_revenue), true);
  animateValue('kpi-orders', parseInt(kpis.total_orders), false);
  animateValue('kpi-customers', parseInt(kpis.total_customers), false);
  animateValue('kpi-aov', parseFloat(kpis.avg_order_value), true);
  animateValue('kpi-profit', parseFloat(kpis.total_profit), true);
  
  const marginEl = document.getElementById('kpi-margin');
  marginEl.textContent = `${parseFloat(kpis.profit_margin_percent).toFixed(1)}%`;
  
  // Set DB type badge
  const dbTypeLabel = document.getElementById('db-type-label');
  const typeText = document.documentElement.getAttribute('data-db') || 'PostgreSQL';
  dbTypeLabel.textContent = typeText;
}

// Smooth counters animation
function animateValue(id, endVal, isCurrency) {
  const obj = document.getElementById(id);
  let startVal = parseFloat(obj.textContent.replace(/[^0-9.-]+/g, '')) || 0;
  
  if (startVal === endVal) {
    obj.textContent = isCurrency ? formatCurrency(endVal) : formatInteger(endVal);
    return;
  }
  
  const duration = 800;
  const startTimestamp = performance.now();
  
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    const val = progress * (endVal - startVal) + startVal;
    
    obj.textContent = isCurrency ? formatCurrency(val) : formatInteger(Math.floor(val));
    
    if (progress < 1) {
      window.requestAnimationFrame(step);
    } else {
      obj.textContent = isCurrency ? formatCurrency(endVal) : formatInteger(endVal);
    }
  };
  window.requestAnimationFrame(step);
}

function formatCurrency(val) {
  return '$' + parseFloat(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatInteger(val) {
  return parseInt(val).toLocaleString();
}

/* ----------------------------------------------------
   5. PAGE loaders & Charts generators
---------------------------------------------------- */

// Setup generic chart helper
function renderOrUpdateChart(chartId, options) {
  if (state.charts[chartId]) {
    // If chart exists, update options and series
    state.charts[chartId].updateOptions(options, true, true);
  } else {
    // Build new chart instance
    const container = document.getElementById(chartId);
    if (!container) return;
    container.innerHTML = ''; // Clear spinners
    
    const chart = new ApexCharts(container, {
      ...options,
      theme: { mode: state.theme }
    });
    chart.render();
    state.charts[chartId] = chart;
  }
}

// Page 1: EXECUTIVE
async function loadExecutiveTab() {
  // A. Insights Engine
  const insights = await fetchApi('/api/insights');
  const insightsList = document.getElementById('insights-list');
  insightsList.innerHTML = '';
  
  if (insights && insights.length > 0) {
    insights.forEach(insight => {
      const li = document.createElement('li');
      li.className = `insight-${insight.type}`;
      
      let icon = 'fa-lightbulb';
      if (insight.type === 'success') icon = 'fa-circle-check';
      else if (insight.type === 'warning') icon = 'fa-triangle-exclamation';
      else if (insight.type === 'danger') icon = 'fa-circle-xmark';
      
      // Parse markdown bold **text** to HTML strong tags
      const formattedText = insight.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      li.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${formattedText}</span>`;
      insightsList.appendChild(li);
    });
  } else {
    insightsList.innerHTML = '<li><i class="fa-solid fa-circle-info"></i> No metrics alerts detected for current filter settings.</li>';
  }

  // B. Revenue Trend Chart
  const trendData = await fetchApi('/api/charts/revenue-trend');
  if (trendData) {
    const categories = trendData.map(d => d.period);
    const revenue = trendData.map(d => parseFloat(d.revenue));
    const profit = trendData.map(d => parseFloat(d.profit));

    const options = {
      series: [
        { name: 'Revenue', data: revenue },
        { name: 'Gross Profit', data: profit }
      ],
      chart: {
        type: 'area',
        height: 320,
        toolbar: { show: false }
      },
      colors: [colors.primary, colors.info],
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: 2 },
      fill: {
        type: 'gradient',
        gradient: {
          opacityFrom: 0.4,
          opacityTo: 0.05,
        }
      },
      xaxis: {
        categories: categories,
        labels: { style: { colors: state.theme === 'dark' ? '#9ca3af' : '#4b5563' } }
      },
      yaxis: {
        labels: {
          formatter: (v) => `$${v.toLocaleString(undefined, {maximumFractionDigits: 0})}`,
          style: { colors: state.theme === 'dark' ? '#9ca3af' : '#4b5563' }
        }
      },
      grid: { borderColor: state.theme === 'dark' ? '#374151' : '#e5e7eb' },
      tooltip: { y: { formatter: (v) => formatCurrency(v) } }
    };
    renderOrUpdateChart('chart-revenue-trend', options);
  }

  // C. Sales by Category
  const catData = await fetchApi('/api/charts/sales-by-category');
  if (catData) {
    const categories = catData.map(d => d.category);
    const revenue = catData.map(d => parseFloat(d.revenue));

    const options = {
      series: [{ name: 'Sales Revenue', data: revenue }],
      chart: { type: 'bar', height: 320, toolbar: { show: false } },
      plotOptions: {
        bar: {
          borderRadius: 8,
          columnWidth: '55%',
          distributed: true
        }
      },
      colors: colors.chartGradients,
      xaxis: {
        categories: categories,
        labels: { style: { colors: state.theme === 'dark' ? '#9ca3af' : '#4b5563' } }
      },
      yaxis: {
        labels: {
          formatter: (v) => `$${v.toLocaleString(undefined, {maximumFractionDigits: 0})}`,
          style: { colors: state.theme === 'dark' ? '#9ca3af' : '#4b5563' }
        }
      },
      grid: { borderColor: state.theme === 'dark' ? '#374151' : '#e5e7eb' },
      legend: { show: false }
    };
    renderOrUpdateChart('chart-sales-category', options);
  }

  // D. Regional Performance Table
  const regData = await fetchApi('/api/charts/regional-sales');
  const regTableBody = document.querySelector('#table-regional-performance tbody');
  regTableBody.innerHTML = '';
  if (regData && regData.length > 0) {
    regData.forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${row.state}</strong></td>
        <td>${row.country}</td>
        <td>${formatCurrency(row.revenue)}</td>
        <td>${formatInteger(row.total_orders)}</td>
        <td>${formatInteger(row.unique_customers)}</td>
      `;
      regTableBody.appendChild(tr);
    });
  } else {
    regTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No regional data found.</td></tr>';
  }

  // E. Top 10 Products Horizontal Bar
  const prodData = await fetchApi('/api/charts/top-products');
  if (prodData) {
    const names = prodData.map(d => d.product_name.length > 20 ? d.product_name.substring(0, 20) + '...' : d.product_name);
    const revenues = prodData.map(d => parseFloat(d.revenue));

    const options = {
      series: [{ name: 'Revenue', data: revenues }],
      chart: { type: 'bar', height: 320, toolbar: { show: false } },
      plotOptions: {
        bar: {
          borderRadius: 6,
          horizontal: true,
          barHeight: '70%'
        }
      },
      colors: [colors.primary],
      xaxis: {
        categories: names,
        labels: {
          formatter: (v) => `$${v.toLocaleString(undefined, {maximumFractionDigits: 0})}`,
          style: { colors: state.theme === 'dark' ? '#9ca3af' : '#4b5563' }
        }
      },
      yaxis: {
        labels: { style: { colors: state.theme === 'dark' ? '#9ca3af' : '#4b5563' } }
      },
      grid: { borderColor: state.theme === 'dark' ? '#374151' : '#e5e7eb' }
    };
    renderOrUpdateChart('chart-top-products', options);
  }
}

// Page 2: CUSTOMERS
async function loadCustomersTab() {
  // A. Customer Growth Signups
  const growthData = await fetchApi('/api/charts/customer-growth');
  if (growthData) {
    const periods = growthData.map(d => d.period);
    const signups = growthData.map(d => parseInt(d.signups));
    const cumulative = growthData.map(d => parseInt(d.cumulative_customers));

    const options = {
      series: [
        { name: 'Monthly Signups', type: 'column', data: signups },
        { name: 'Cumulative Users', type: 'line', data: cumulative }
      ],
      chart: { height: 320, type: 'line', toolbar: { show: false } },
      stroke: { width: [0, 3], curve: 'smooth' },
      colors: [colors.info, colors.primary],
      xaxis: {
        categories: periods,
        labels: { style: { colors: state.theme === 'dark' ? '#9ca3af' : '#4b5563' } }
      },
      yaxis: [
        {
          title: { text: 'Monthly Signups' },
          labels: { style: { colors: state.theme === 'dark' ? '#9ca3af' : '#4b5563' } }
        },
        {
          opposite: true,
          title: { text: 'Cumulative Base' },
          labels: { style: { colors: state.theme === 'dark' ? '#9ca3af' : '#4b5563' } }
        }
      ],
      grid: { borderColor: state.theme === 'dark' ? '#374151' : '#e5e7eb' }
    };
    renderOrUpdateChart('chart-customer-growth', options);
  }

  // B. Customer RFM Segmentation distribution
  const segData = await fetchApi('/api/charts/customer-segmentation');
  if (segData) {
    const segments = segData.map(d => d.segment);
    const counts = segData.map(d => parseInt(d.customer_count));

    const options = {
      series: [{ name: 'Customers', data: counts }],
      chart: { type: 'bar', height: 320, toolbar: { show: false } },
      plotOptions: {
        bar: {
          borderRadius: 8,
          distributed: true,
          columnWidth: '50%'
        }
      },
      colors: [colors.success, colors.info, colors.primary, colors.warning],
      xaxis: {
        categories: segments,
        labels: { style: { colors: state.theme === 'dark' ? '#9ca3af' : '#4b5563' } }
      },
      grid: { borderColor: state.theme === 'dark' ? '#374151' : '#e5e7eb' },
      legend: { show: false }
    };
    renderOrUpdateChart('chart-customer-segmentation', options);
  }

  // C. Gender Distribution Donut
  const genderData = await fetchApi('/api/charts/gender-distribution');
  if (genderData) {
    const genders = genderData.map(d => d.gender || 'Unknown');
    const counts = genderData.map(d => parseInt(d.customer_count));

    const options = {
      series: counts,
      chart: { type: 'donut', height: 300 },
      labels: genders,
      colors: [colors.primary, colors.accent2, colors.info, colors.gray],
      legend: {
        position: 'bottom',
        labels: { colors: state.theme === 'dark' ? '#f3f4f6' : '#1f2937' }
      },
      stroke: { show: false }
    };
    renderOrUpdateChart('chart-gender-distribution', options);
  }

  // D. Cohort LTV Table
  const ltvData = await fetchApi('/api/charts/customer-ltv');
  const ltvTableBody = document.querySelector('#table-customer-ltv tbody');
  ltvTableBody.innerHTML = '';
  if (ltvData && ltvData.length > 0) {
    ltvData.forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${row.cohort_month}</strong></td>
        <td>${formatInteger(row.cohort_size)}</td>
        <td>${formatCurrency(row.month_0_rev / row.cohort_size)}</td>
        <td>${formatCurrency(row.month_1_3_rev / row.cohort_size)}</td>
        <td>${formatCurrency(row.month_4_6_rev / row.cohort_size)}</td>
        <td>${formatCurrency(row.month_7plus_rev / row.cohort_size)}</td>
        <td><strong>${formatCurrency(row.average_ltv)}</strong></td>
      `;
      ltvTableBody.appendChild(tr);
    });
  } else {
    ltvTableBody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No cohort data.</td></tr>';
  }

  // E. Top 15 Customer Table
  const topCustData = await fetchApi('/api/charts/top-customers-table');
  const topCustBody = document.querySelector('#table-top-customers tbody');
  topCustBody.innerHTML = '';
  if (topCustData && topCustData.length > 0) {
    topCustData.forEach(c => {
      const tr = document.createElement('tr');
      let segClass = 'badge';
      if (c.segment === 'Platinum') segClass += ' rev-color';
      else if (c.segment === 'Gold') segClass += ' orders-color';
      else if (c.segment === 'Silver') segClass += ' margin-color';
      else segClass += ' bg-card';
      
      tr.innerHTML = `
        <td>${c.customer_id}</td>
        <td><strong>${c.customer_name}</strong></td>
        <td>${c.email}</td>
        <td>${c.state}, ${c.country}</td>
        <td>${formatInteger(c.total_orders)}</td>
        <td>${formatCurrency(c.total_revenue)}</td>
        <td>${formatCurrency(c.avg_order_value)}</td>
        <td><span class="${segClass}">${c.segment}</span></td>
      `;
      topCustBody.appendChild(tr);
    });
  } else {
    topCustBody.innerHTML = '<tr><td colspan="8" style="text-align:center;">No customers found.</td></tr>';
  }
}

// Page 3: PRODUCTS
async function loadProductsTab() {
  // A. Treemap category subcategory
  const treeData = await fetchApi('/api/charts/category-treemap');
  if (treeData) {
    const formattedData = treeData.map(d => ({
      x: `${d.category} - ${d.subcategory}`,
      y: parseFloat(d.revenue)
    }));

    const options = {
      series: [{ data: formattedData }],
      chart: { type: 'treemap', height: 350, toolbar: { show: false } },
      colors: colors.chartGradients,
      legend: { show: false },
      plotOptions: {
        treemap: {
          enableShades: true,
          shadeIntensity: 0.5
        }
      }
    };
    renderOrUpdateChart('chart-category-treemap', options);
  }

  // B. Product Matrix Scatter/Bubble
  const matrixData = await fetchApi('/api/charts/product-matrix');
  if (matrixData) {
    // Standardizing formats: bubble coordinates [x, y, size]
    const bubbleSeries = {};
    matrixData.forEach(d => {
      if (!bubbleSeries[d.category]) {
        bubbleSeries[d.category] = [];
      }
      bubbleSeries[d.category].push({
        name: d.product_name,
        x: parseInt(d.quantity_sold),
        y: Math.round(parseFloat(d.revenue)),
        z: Math.max(1, Math.round(parseFloat(d.profit) / 100)) // Size of bubble based on profit
      });
    });

    const series = Object.keys(bubbleSeries).map(catName => ({
      name: catName,
      data: bubbleSeries[catName]
    }));

    const options = {
      series: series,
      chart: { type: 'bubble', height: 350, toolbar: { show: false } },
      dataLabels: { enabled: false },
      fill: { opacity: 0.8 },
      xaxis: {
        title: { text: 'Units Sold (Quantity)' },
        labels: { style: { colors: state.theme === 'dark' ? '#9ca3af' : '#4b5563' } }
      },
      yaxis: {
        title: { text: 'Revenue generated ($)' },
        labels: {
          formatter: (v) => `$${v.toLocaleString()}`,
          style: { colors: state.theme === 'dark' ? '#9ca3af' : '#4b5563' }
        }
      },
      grid: { borderColor: state.theme === 'dark' ? '#374151' : '#e5e7eb' },
      tooltip: {
        custom: function({ series, seriesIndex, dataPointIndex, w }) {
          const item = w.config.series[seriesIndex].data[dataPointIndex];
          const tooltipBg = state.theme === 'dark' ? '#1f2937' : '#ffffff';
          const tooltipBorder = state.theme === 'dark' ? '#374151' : '#cbd5e1';
          const tooltipText = state.theme === 'dark' ? '#f8fafc' : '#0f172a';
          return `
            <div style="padding: 10px; font-size: 12px; font-family: var(--font-body); background: ${tooltipBg}; border: 1px solid ${tooltipBorder}; color: ${tooltipText}; border-radius: 6px; box-shadow: var(--shadow-main);">
              <strong>${item.name}</strong><br>
              Category: ${w.config.series[seriesIndex].name}<br>
              Units Sold: ${item.x}<br>
              Revenue: $${item.y.toLocaleString()}<br>
              Profit Index: ${item.z}
            </div>
          `;
        }
      }
    };
    renderOrUpdateChart('chart-product-matrix', options);
  }

  // C. Product Profitability Table
  const profData = await fetchApi('/api/charts/product-profitability');
  const profBody = document.querySelector('#table-product-profitability tbody');
  profBody.innerHTML = '';
  if (profData && profData.length > 0) {
    profData.forEach(row => {
      const tr = document.createElement('tr');
      let labelClass = 'badge';
      if (row.profitability_segment.includes('Critical')) labelClass += ' rev-color';
      else if (row.profitability_segment.includes('Niche')) labelClass += ' orders-color';
      else if (row.profitability_segment.includes('Star')) labelClass += ' margin-color';
      else labelClass += ' bg-card';
      
      tr.innerHTML = `
        <td><strong>${row.product_name.substring(0, 25)}...</strong></td>
        <td>${row.category}</td>
        <td>${formatCurrency(row.revenue)}</td>
        <td>${formatCurrency(row.profit)}</td>
        <td>${parseFloat(row.margin_percent).toFixed(1)}%</td>
        <td><span class="${labelClass}">${row.profitability_segment}</span></td>
      `;
      profBody.appendChild(tr);
    });
  } else {
    profBody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No products analyzed.</td></tr>';
  }

  // D. Product Leaderboards (Top 5 & Bottom 5)
  const topProdData = await fetchApi('/api/charts/top-products');
  if (topProdData) {
    const topBody = document.querySelector('#table-top-selling-mini tbody');
    topBody.innerHTML = '';
    const top5 = topProdData.slice(0, 5);
    top5.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${p.product_name.substring(0, 20)}...</strong></td>
        <td>${p.category}</td>
        <td>${formatInteger(p.units_sold)}</td>
        <td>${formatCurrency(p.revenue)}</td>
      `;
      topBody.appendChild(tr);
    });

    // We can query a separate bottom endpoint or reverse sort.
    // For simplicity, let's reverse sort the product matrix elements to find low units_sold
    const botBody = document.querySelector('#table-bottom-selling-mini tbody');
    botBody.innerHTML = '';
    
    // Sort products by unit sold ASC
    if (matrixData && matrixData.length > 0) {
      const bot5 = [...matrixData].sort((a, b) => parseInt(a.quantity_sold) - parseInt(b.quantity_sold)).slice(0, 5);
      bot5.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${p.product_name.substring(0, 20)}...</strong></td>
          <td>${p.category}</td>
          <td>${formatInteger(p.quantity_sold)}</td>
          <td>${formatCurrency(p.revenue)}</td>
        `;
        botBody.appendChild(tr);
      });
    }
  }
}

// Page 4: ORDERS
async function loadOrdersTab() {
  // A. Orders by Status Donut
  const statusData = await fetchApi('/api/charts/orders-by-status');
  if (statusData) {
    const statuses = statusData.map(d => d.order_status);
    const counts = statusData.map(d => parseInt(d.order_count));
    
    // Calculate processing pct for top KPI card summary
    const totalOrders = counts.reduce((a, b) => a + b, 0);
    const procItem = statusData.find(d => d.order_status === 'Processing');
    const procPct = procItem && totalOrders > 0 ? ((parseInt(procItem.order_count) / totalOrders) * 100).toFixed(1) : '0';
    document.getElementById('kpi-order-processing-pct').textContent = `${procPct}%`;

    const options = {
      series: counts,
      chart: { type: 'pie', height: 320 },
      labels: statuses,
      colors: [colors.success, colors.danger, colors.warning, colors.info],
      legend: {
        position: 'bottom',
        labels: { colors: state.theme === 'dark' ? '#f3f4f6' : '#1f2937' }
      },
      stroke: { show: false }
    };
    renderOrUpdateChart('chart-orders-status', options);
  }

  // B. Return rates by Category
  const retData = await fetchApi('/api/charts/return-rate');
  if (retData) {
    const categories = retData.map(d => d.category);
    const rates = retData.map(d => parseFloat(d.return_rate));

    const options = {
      series: [{ name: 'Return Rate %', data: rates }],
      chart: { type: 'bar', height: 320, toolbar: { show: false } },
      colors: [colors.danger],
      plotOptions: {
        bar: {
          borderRadius: 6,
          columnWidth: '40%'
        }
      },
      xaxis: {
        categories: categories,
        labels: { style: { colors: state.theme === 'dark' ? '#9ca3af' : '#4b5563' } }
      },
      yaxis: {
        labels: {
          formatter: (v) => `${parseFloat(v).toFixed(1)}%`,
          style: { colors: state.theme === 'dark' ? '#9ca3af' : '#4b5563' }
        }
      },
      grid: { borderColor: state.theme === 'dark' ? '#374151' : '#e5e7eb' }
    };
    renderOrUpdateChart('chart-return-rate', options);
  }

  // C. Cancellation rates by subcategory
  const cancelData = await fetchApi('/api/charts/cancellation-rate');
  if (cancelData) {
    const subcats = cancelData.map(d => `${d.category} - ${d.subcategory}`);
    const rates = cancelData.map(d => parseFloat(d.cancellation_rate));

    const options = {
      series: [{ name: 'Cancellation Rate %', data: rates }],
      chart: { type: 'bar', height: 320, toolbar: { show: false } },
      colors: [colors.warning],
      plotOptions: {
        bar: {
          borderRadius: 6,
          horizontal: true,
          barHeight: '60%'
        }
      },
      xaxis: {
        labels: {
          formatter: (v) => `${parseFloat(v).toFixed(1)}%`,
          style: { colors: state.theme === 'dark' ? '#9ca3af' : '#4b5563' }
        }
      },
      yaxis: {
        labels: { style: { colors: state.theme === 'dark' ? '#9ca3af' : '#4b5563' } }
      },
      grid: { borderColor: state.theme === 'dark' ? '#374151' : '#e5e7eb' }
    };
    renderOrUpdateChart('chart-cancellation-rate', options);
  }
}

/* ----------------------------------------------------
   6. Portfolio SQL Console Features
---------------------------------------------------- */
async function initSQLConsole() {
  const querySelector = document.getElementById('sql-query-selector');
  const runBtn = document.getElementById('btn-run-sql');
  const copyBtn = document.getElementById('btn-copy-sql');
  const editor = document.getElementById('sql-editor');
  const descriptionBox = document.getElementById('selected-query-description');
  
  // A. Fetch Queries Registry
  try {
    const res = await fetch('/api/sql/queries');
    const json = await res.json();
    if (json.success && json.data) {
      state.sqlQueries = json.data;
      
      // Populate select options
      querySelector.innerHTML = '';
      state.sqlQueries.forEach((q, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = q.name;
        querySelector.appendChild(opt);
      });
      
      // Load first query
      if (state.sqlQueries.length > 0) {
        loadSelectedQuery(0);
      }
    }
  } catch (err) {
    console.error('Failed to load SQL queries registry:', err);
  }

  querySelector.addEventListener('change', (e) => {
    loadSelectedQuery(e.target.value);
  });

  function loadSelectedQuery(idx) {
    const q = state.sqlQueries[idx];
    if (q) {
      editor.value = q.sql;
      descriptionBox.innerHTML = `<strong>Concept Description:</strong><br>${q.description}`;
    }
  }

  // B. Run SQL Click Event
  runBtn.addEventListener('click', async () => {
    const sqlText = editor.value;
    const resultsContainer = document.getElementById('sql-results-table-container');
    const resultsCount = document.getElementById('results-count');
    
    resultsContainer.innerHTML = '<div class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i><p>Executing SQL query on database...</p></div>';
    resultsCount.textContent = '0 Rows';
    
    try {
      const res = await fetch('/api/sql/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: sqlText })
      });
      
      const json = await res.json();
      
      if (!json.success) {
        // Render detailed SQL database error alert
        resultsContainer.innerHTML = `
          <div style="padding: 15px; border-radius: 8px; background: hsla(355,80%,55%,0.15); border: 1px solid var(--danger); color: var(--danger); font-size: 0.85rem;">
            <strong><i class="fa-solid fa-triangle-exclamation"></i> SQL Database Error:</strong><br>${json.error}
          </div>
        `;
        return;
      }
      
      const rows = json.rows;
      const headers = json.headers;
      resultsCount.textContent = `${json.rowCount || 0} Rows`;
      
      if (!rows || rows.length === 0) {
        resultsContainer.innerHTML = '<div class="empty-state"><i class="fa-solid fa-circle-info"></i><p>Query executed successfully. Result returned 0 rows.</p></div>';
        return;
      }
      
      // Draw dynamic table Grid
      let tableHtml = `<table class="data-table"><thead><tr>`;
      headers.forEach(h => {
        tableHtml += `<th>${h}</th>`;
      });
      tableHtml += `</tr></thead><tbody>`;
      
      rows.forEach(row => {
        tableHtml += `<tr>`;
        headers.forEach(h => {
          let val = row[h];
          if (val === null || val === undefined) val = '-';
          else if (typeof val === 'number') {
            if (h.includes('revenue') || h.includes('spend') || h.includes('profit') || h.includes('value') || h.includes('monetary') || h.includes('ltv') || h.includes('price')) {
              val = formatCurrency(val);
            } else if (h.includes('_pct') || h.includes('rate') || h.includes('margin')) {
              val = `${parseFloat(val).toFixed(1)}%`;
            } else {
              val = val.toLocaleString();
            }
          }
          tableHtml += `<td>${val}</td>`;
        });
        tableHtml += `</tr>`;
      });
      
      tableHtml += `</tbody></table>`;
      resultsContainer.innerHTML = tableHtml;
      
    } catch (err) {
      resultsContainer.innerHTML = `<div style="padding:15px; color:var(--danger); background:var(--danger-glow); border:1px solid var(--danger); border-radius:8px;">Execution failed: ${err.message}</div>`;
    }
  });

  // C. Copy SQL Button
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(editor.value)
      .then(() => {
        const originalText = copyBtn.innerHTML;
        copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
        setTimeout(() => copyBtn.innerHTML = originalText, 1500);
      });
  });
}

/* ----------------------------------------------------
   7. PDF / CSV Export Managers
---------------------------------------------------- */
function initExportAndReport() {
  document.getElementById('export-pdf').addEventListener('click', () => {
    window.print();
  });

  document.getElementById('export-csv').addEventListener('click', () => {
    // Generate simple CSV representation of the active tab data
    const activeTab = state.activeTab;
    let csvContent = "data:text/csv;charset=utf-8,";
    let filename = `bi_suite_${activeTab}_report.csv`;
    
    if (activeTab === 'executive') {
      const regTable = document.getElementById('table-regional-performance');
      csvContent += extractTableToCsv(regTable);
    } else if (activeTab === 'customers') {
      const topCustTable = document.getElementById('table-top-customers');
      csvContent += extractTableToCsv(topCustTable);
    } else if (activeTab === 'products') {
      const profTable = document.getElementById('table-product-profitability');
      csvContent += extractTableToCsv(profTable);
    } else {
      csvContent += "Metric,Value\n";
      csvContent += `Total Revenue,${document.getElementById('kpi-revenue').textContent.replace(/,/g, '')}\n`;
      csvContent += `Total Orders,${document.getElementById('kpi-orders').textContent.replace(/,/g, '')}\n`;
      csvContent += `Total Customers,${document.getElementById('kpi-customers').textContent.replace(/,/g, '')}\n`;
    }

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
}

function extractTableToCsv(tableEl) {
  if (!tableEl) return '';
  let csv = '';
  const rows = tableEl.querySelectorAll('tr');
  rows.forEach(row => {
    const cols = row.querySelectorAll('th, td');
    const rowData = [];
    cols.forEach(col => {
      let text = col.textContent.trim().replace(/"/g, '""');
      if (text.includes(',') || text.includes('\n')) {
        text = `"${text}"`;
      }
      rowData.push(text);
    });
    csv += rowData.join(',') + '\n';
  });
  return csv;
}
