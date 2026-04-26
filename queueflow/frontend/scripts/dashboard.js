'use strict';

// ===== FAKE DATA GENERATOR =====
const TASKS = ['send_email','resize_image','generate_pdf','sync_crm','process_payment','compress_video'];
const STATUSES = ['queued','processing','completed','completed','completed','failed'];

function fakeJob(i) {
  const createdAt = new Date(Date.now() - Math.random() * 3600000);
  return {
    _id: Math.random().toString(36).slice(2,10),
    task: TASKS[Math.floor(Math.random() * TASKS.length)],
    status: STATUSES[Math.floor(Math.random() * STATUSES.length)],
    priority: Math.floor(Math.random() * 10) + 1,
    retries: Math.floor(Math.random() * 3),
    createdAt
  };
}

// Seed initial jobs
let jobs = Array.from({ length: 30 }, (_, i) => fakeJob(i));

// ===== METRICS STATE =====
let processed = 0;
let failed = 0;
let throughputHistory = Array(20).fill(0);
let failHistory = Array(20).fill(0);

// ===== CHART SETUP =====
let throughputChart, statusChart;

function initCharts() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
  const labelColor = isDark ? '#5a5875' : '#a8a5c0';

  const tCtx = document.getElementById('throughputChart');
  if (!tCtx) return;

  throughputChart = new Chart(tCtx, {
    type: 'line',
    data: {
      labels: throughputHistory.map((_, i) => `${i}s`),
      datasets: [
        {
          label: 'Processed',
          data: [...throughputHistory],
          borderColor: '#7c6fff',
          backgroundColor: 'rgba(124,111,255,0.08)',
          borderWidth: 2,
          tension: 0.4,
          fill: true,
          pointRadius: 0
        },
        {
          label: 'Failed',
          data: [...failHistory],
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239,68,68,0.05)',
          borderWidth: 1.5,
          tension: 0.4,
          fill: true,
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: labelColor, font: { family: 'DM Mono', size: 10 }, maxTicksLimit: 6 } },
        y: { grid: { color: gridColor }, ticks: { color: labelColor, font: { family: 'DM Mono', size: 10 } }, beginAtZero: true }
      },
      animation: { duration: 300 }
    }
  });

  const sCtx = document.getElementById('statusChart');
  if (!sCtx) return;

  statusChart = new Chart(sCtx, {
    type: 'doughnut',
    data: {
      labels: ['Completed','Processing','Queued','Failed'],
      datasets: [{
        data: [18, 4, 6, 2],
        backgroundColor: ['#10b981','#f59e0b','#22d3ee','#ef4444'],
        borderWidth: 0,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { color: labelColor, font: { family: 'DM Mono', size: 10 }, boxWidth: 10, padding: 12 }
        }
      },
      cutout: '68%',
      animation: { duration: 400 }
    }
  });
}

// ===== RENDER JOB LIST =====
function renderJobList() {
  const container = document.getElementById('jobList');
  if (!container) return;

  const filter = window.dashboardFilter || 'all';
  const filtered = filter === 'all' ? jobs : jobs.filter(j => j.status === filter);
  const visible = filtered.slice(0, 15);

  container.innerHTML = `
    <div class="job-row job-row-header">
      <span>Task</span>
      <span>ID</span>
      <span>Status</span>
      <span>Priority</span>
      <span>Retries</span>
    </div>
    ${visible.map(j => `
      <div class="job-row">
        <span style="font-family:var(--font-mono);font-size:0.8rem">${j.task}</span>
        <span class="job-id">#${j._id.slice(0,8)}</span>
        <span><span class="status-badge status-${j.status}">${j.status}</span></span>
        <span class="priority-badge ${j.priority >= 7 ? 'priority-high' : j.priority >= 4 ? 'priority-med' : 'priority-low'}">${j.priority}/10</span>
        <span style="color:var(--text-muted);font-family:var(--font-mono);font-size:0.75rem">${j.retries}</span>
      </div>
    `).join('')}
  `;
}
window.renderJobList = renderJobList;

// ===== LIVE METRICS UPDATE =====
function updateMetrics() {
  // Simulate new jobs arriving and processing
  const newProcessed = Math.floor(Math.random() * 8) + 2;
  const newFailed = Math.random() < 0.2 ? 1 : 0;
  processed += newProcessed;
  failed += newFailed;

  const queueDepth = Math.floor(Math.random() * 80) + 10;
  const successRate = processed > 0 ? ((processed / (processed + failed)) * 100).toFixed(1) : 100;
  const latency = (Math.random() * 15 + 5).toFixed(0);

  // Update DOM
  const fields = [
    { id: 'metricQueueDepth', val: queueDepth.toLocaleString() },
    { id: 'metricProcessed', val: processed.toLocaleString() },
    { id: 'metricSuccessRate', val: successRate + '%' },
    { id: 'metricLatency', val: latency + 'ms' }
  ];
  fields.forEach(({ id, val }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = val;
    el.classList.remove('updated');
    void el.offsetWidth; // reflow
    el.classList.add('updated');
  });

  // Update throughput chart
  throughputHistory.push(newProcessed);
  throughputHistory.shift();
  failHistory.push(newFailed);
  failHistory.shift();

  if (throughputChart) {
    throughputChart.data.datasets[0].data = [...throughputHistory];
    throughputChart.data.datasets[1].data = [...failHistory];
    throughputChart.update();
  }

  // Update doughnut chart
  const completed = jobs.filter(j => j.status === 'completed').length;
  const processing = jobs.filter(j => j.status === 'processing').length;
  const queued = jobs.filter(j => j.status === 'queued').length;
  const failedCount = jobs.filter(j => j.status === 'failed').length;

  if (statusChart) {
    statusChart.data.datasets[0].data = [completed, processing, queued, failedCount];
    statusChart.update();
  }

  // Add a new fake job occasionally
  if (Math.random() < 0.5) {
    jobs.unshift(fakeJob(jobs.length));
    if (jobs.length > 60) jobs.pop();
    renderJobList();
  }
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  initCharts();
  renderJobList();
  setInterval(updateMetrics, 2000);
  updateMetrics();
});

// Re-init charts on theme change
const observer = new MutationObserver(() => {
  if (throughputChart) throughputChart.destroy();
  if (statusChart) statusChart.destroy();
  initCharts();
});
observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });