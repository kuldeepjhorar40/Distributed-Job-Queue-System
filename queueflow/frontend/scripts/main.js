'use strict';

// ===== THEME TOGGLE =====
const html = document.documentElement;
const themeToggle = document.getElementById('themeToggle');

function setTheme(theme) {
  html.setAttribute('data-theme', theme);
  localStorage.setItem('qf-theme', theme);
}

themeToggle.addEventListener('click', () => {
  const current = html.getAttribute('data-theme');
  setTheme(current === 'dark' ? 'light' : 'dark');
});

// Restore saved theme
const savedTheme = localStorage.getItem('qf-theme');
if (savedTheme) setTheme(savedTheme);

// ===== NAVBAR SCROLL =====
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 20);
}, { passive: true });

// ===== STAT COUNTER ANIMATION =====
function animateCount(el, target, suffix = '') {
  const duration = 1800;
  const start = Date.now();
  const update = () => {
    const elapsed = Date.now() - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = Math.floor(eased * target);
    el.textContent = value.toLocaleString() + suffix;
    if (progress < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}

// Trigger stats when hero is visible
const heroObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      document.querySelectorAll('.stat-value[data-count]').forEach(el => {
        const target = parseInt(el.dataset.count);
        animateCount(el, target);
      });
      heroObserver.disconnect();
    }
  });
}, { threshold: 0.3 });

const heroEl = document.querySelector('.hero');
if (heroEl) heroObserver.observe(heroEl);

// ===== FLOW CANVAS ANIMATION =====
function initFlowCanvas() {
  const canvas = document.getElementById('flowCanvas');
  const svg = document.getElementById('flowLines');
  if (!canvas || !svg) return;

  const producers = canvas.querySelectorAll('.flow-node.producer');
  const workers = canvas.querySelectorAll('.flow-node.worker');
  const queueTrack = canvas.querySelector('.queue-track');
  const queueJobs = document.getElementById('queueJobs');

  // Draw animated flow lines
  function drawLines() {
    svg.innerHTML = '';
    const rect = canvas.getBoundingClientRect();

    const getCenter = (el) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.left - rect.left + r.width / 2,
        y: r.top - rect.top + r.height / 2
      };
    };

    const qCenter = getCenter(queueTrack);

    producers.forEach((p, i) => {
      const pCenter = getCenter(p);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const mx = (pCenter.x + qCenter.x) / 2;
      line.setAttribute('d', `M${pCenter.x},${pCenter.y} C${mx},${pCenter.y} ${mx},${qCenter.y} ${qCenter.x},${qCenter.y}`);
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', 'rgba(124,111,255,0.35)');
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('stroke-dasharray', '6 4');
      line.classList.add('flow-line-animated');
      line.style.animationDelay = `${i * 0.3}s`;
      svg.appendChild(line);
    });

    workers.forEach((w, i) => {
      const wCenter = getCenter(w);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const mx = (qCenter.x + wCenter.x) / 2;
      line.setAttribute('d', `M${qCenter.x},${qCenter.y} C${mx},${qCenter.y} ${mx},${wCenter.y} ${wCenter.x},${wCenter.y}`);
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', 'rgba(16,185,129,0.35)');
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('stroke-dasharray', '6 4');
      line.classList.add('flow-line-animated', 'slow');
      line.style.animationDelay = `${i * 0.4}s`;
      svg.appendChild(line);
    });
  }

  // Animate queue items
  function addQueueJob() {
    if (!queueJobs) return;
    const priorities = ['priority-high', '', 'priority-low'];
    const p = priorities[Math.floor(Math.random() * priorities.length)];
    const job = document.createElement('div');
    job.className = `queue-job-item ${p}`;
    queueJobs.appendChild(job);
    if (queueJobs.children.length > 8) {
      const first = queueJobs.firstChild;
      if (first) first.remove();
    }
  }

  // Initial jobs
  for (let i = 0; i < 5; i++) addQueueJob();

  // Add jobs periodically
  setInterval(addQueueJob, 1200);
  setInterval(drawLines, 500);
  drawLines();
}

window.addEventListener('load', initFlowCanvas);
window.addEventListener('resize', initFlowCanvas);

// ===== API PANEL SWITCHER =====
document.querySelectorAll('.api-endpoint').forEach(ep => {
  ep.addEventListener('click', () => {
    document.querySelectorAll('.api-endpoint').forEach(e => e.classList.remove('active'));
    document.querySelectorAll('.api-panel').forEach(p => p.classList.add('hidden'));
    ep.classList.add('active');
    const panelId = `panel-${ep.dataset.endpoint}`;
    const panel = document.getElementById(panelId);
    if (panel) panel.classList.remove('hidden');
  });
});

// ===== FILTER TABS (Dashboard) =====
document.querySelectorAll('.filter-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    window.dashboardFilter = tab.dataset.filter;
    if (window.renderJobList) window.renderJobList();
  });
});
window.dashboardFilter = 'all';