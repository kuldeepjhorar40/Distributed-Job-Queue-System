'use strict';

// ===== SIMULATION ENGINE =====
class QueueSimulator {
  constructor() {
    this.queue = [];
    this.workers = [];
    this.log = [];
    this.running = false;
    this.speed = 1;
    this.jobId = 0;
    this.timer = null;
    this.failRate = 0.15;
    this.workerCount = 3;
    this.jobCount = 20;
    this.taskTypes = ['send_email', 'sync_crm'];
  }

  reset() {
    clearInterval(this.timer);
    this.queue = [];
    this.workers = [];
    this.log = [];
    this.running = false;
    this.jobId = 0;
    this.renderAll();
    this.addLog('system', 'System reset. Configure and start simulation.');
  }

  start() {
    this.running = true;
    this.initWorkers();
    this.enqueueJobs();
    this.timer = setInterval(() => this.tick(), Math.max(200, 800 / this.speed));
  }

  stop() {
    clearInterval(this.timer);
    this.running = false;
  }

  initWorkers() {
    this.workers = Array.from({ length: this.workerCount }, (_, i) => ({
      id: i + 1, status: 'idle', job: null, retryCount: 0
    }));
  }

  enqueueJobs() {
    const tasks = this.taskTypes.length > 0 ? this.taskTypes : ['send_email'];
    for (let i = 0; i < this.jobCount; i++) {
      const job = {
        id: ++this.jobId,
        task: tasks[Math.floor(Math.random() * tasks.length)],
        priority: Math.floor(Math.random() * 10) + 1,
        retries: 0,
        maxRetries: 3,
        status: 'queued',
        delay: 0
      };
      // Priority queue insert (higher priority first)
      const insertIdx = this.queue.findIndex(q => q.priority < job.priority);
      if (insertIdx === -1) this.queue.push(job);
      else this.queue.splice(insertIdx, 0, job);
      this.addLog('enqueue', `[ENQUEUE] Job #${job.id} → ${job.task} (priority ${job.priority})`);
    }
    this.renderQueue();
  }

  tick() {
    // Process delayed/retrying jobs
    this.queue.forEach(j => {
      if (j.delay > 0) j.delay--;
    });

    // Assign idle workers
    this.workers.forEach(worker => {
      if (worker.status === 'idle') {
        const readyJob = this.queue.find(j => j.status === 'queued' && j.delay === 0);
        if (readyJob) {
          readyJob.status = 'processing';
          worker.status = 'busy';
          worker.job = readyJob;
          worker.ticksLeft = Math.floor(Math.random() * 3) + 2; // 2-4 ticks
          this.addLog('process', `[WORKER ${worker.id}] Processing #${readyJob.id} (${readyJob.task})`);
        }
      } else if (worker.status === 'busy') {
        worker.ticksLeft--;
        if (worker.ticksLeft <= 0) {
          this.completeJob(worker);
        }
      }
    });

    // Check if simulation is done
    const active = this.queue.some(j => j.status === 'queued' || j.status === 'processing');
    if (!active && this.running) {
      this.stop();
      this.addLog('system', '✓ Simulation complete.');
    }

    this.renderAll();
  }

  completeJob(worker) {
    const job = worker.job;
    if (!job) return;

    const failed = Math.random() < this.failRate;

    if (failed && job.retries < job.maxRetries) {
      job.retries++;
      job.status = 'queued';
      const backoff = Math.pow(2, job.retries);
      job.delay = Math.ceil(backoff / (800 / Math.max(this.speed, 1)) * 2);
      worker.status = 'idle';
      worker.job = null;
      this.addLog('retry', `[RETRY] Job #${job.id} failed → retry ${job.retries}/${job.maxRetries} (backoff ${backoff}s)`);
    } else if (failed && job.retries >= job.maxRetries) {
      job.status = 'failed';
      const idx = this.queue.indexOf(job);
      if (idx !== -1) this.queue.splice(idx, 1);
      worker.status = 'idle';
      worker.job = null;
      this.addLog('fail', `[FAILED] Job #${job.id} → sent to Dead Letter Queue after ${job.retries} retries`);
    } else {
      job.status = 'completed';
      const idx = this.queue.indexOf(job);
      if (idx !== -1) this.queue.splice(idx, 1);
      worker.status = 'idle';
      worker.job = null;
      this.addLog('success', `[DONE] Job #${job.id} (${job.task}) completed successfully`);
    }
  }

  addLog(type, message) {
    const timestamp = new Date().toISOString().slice(11,19);
    this.log.unshift({ type, message: `${timestamp} ${message}` });
    if (this.log.length > 100) this.log.pop();
    this.renderLog();
  }

  renderQueue() {
    const el = document.getElementById('simQueueVisual');
    if (!el) return;
    const pending = this.queue.filter(j => j.status === 'queued');
    if (pending.length === 0) {
      el.innerHTML = '<div class="sim-empty">Queue empty</div>';
      return;
    }
    el.innerHTML = pending.slice(0, 40).map(j => `
      <div class="sim-job-chip priority-${j.priority}" title="${j.task} | priority ${j.priority} | retries ${j.retries}">
        #${j.id} p${j.priority}${j.retries > 0 ? ` ↻${j.retries}` : ''}
      </div>
    `).join('');
  }

  renderWorkers() {
    const el = document.getElementById('simWorkersVisual');
    if (!el) return;
    if (this.workers.length === 0) {
      el.innerHTML = '<div class="sim-empty">No workers initialized</div>';
      return;
    }
    el.innerHTML = this.workers.map(w => `
      <div class="sim-worker-card ${w.status}">
        <div class="worker-card-id">Worker ${w.id}</div>
        <div class="worker-card-job">${w.job ? w.job.task : '—'}</div>
        <div class="worker-card-status">${w.status === 'busy' ? 'processing' : 'idle'}</div>
      </div>
    `).join('');
  }

  renderLog() {
    const el = document.getElementById('simLog');
    if (!el) return;
    el.innerHTML = this.log.slice(0, 50).map(e =>
      `<div class="log-entry log-entry--${e.type}">${e.message}</div>`
    ).join('');
  }

  renderAll() {
    this.renderQueue();
    this.renderWorkers();
  }
}

// ===== UI WIRING =====
document.addEventListener('DOMContentLoaded', () => {
  const sim = new QueueSimulator();

  // Slider bindings
  const bind = (sliderId, displayId, transform = v => v) => {
    const slider = document.getElementById(sliderId);
    const display = document.getElementById(displayId);
    if (!slider || !display) return;
    slider.addEventListener('input', () => { display.textContent = transform(slider.value); });
  };

  bind('simJobCount', 'simJobCountVal');
  bind('simWorkerCount', 'simWorkerCountVal');
  bind('simFailRate', 'simFailRateVal', v => `${v}%`);

  // Speed buttons
  document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      sim.speed = parseFloat(btn.dataset.speed);
      if (sim.running) {
        clearInterval(sim.timer);
        sim.timer = setInterval(() => sim.tick(), Math.max(200, 800 / sim.speed));
      }
    });
  });

  // Start
  document.getElementById('simStart')?.addEventListener('click', () => {
    if (sim.running) { sim.stop(); return; }
    const jobCount = parseInt(document.getElementById('simJobCount')?.value || 20);
    const workerCount = parseInt(document.getElementById('simWorkerCount')?.value || 3);
    const failRate = parseInt(document.getElementById('simFailRate')?.value || 15) / 100;
    const speed = parseFloat(document.querySelector('.speed-btn.active')?.dataset.speed || 1);
    const tasks = Array.from(document.querySelectorAll('.task-checkbox input:checked')).map(i => i.value);

    sim.reset();
    sim.jobCount = jobCount;
    sim.workerCount = workerCount;
    sim.failRate = failRate;
    sim.speed = speed;
    sim.taskTypes = tasks.length > 0 ? tasks : ['send_email'];
    sim.start();

    const btn = document.getElementById('simStart');
    if (btn) { btn.textContent = '⏹ Stop'; }
  });

  // Reset
  document.getElementById('simReset')?.addEventListener('click', () => {
    sim.reset();
    const btn = document.getElementById('simStart');
    if (btn) btn.textContent = '▶ Start Simulation';
  });

  sim.renderAll();
  sim.addLog('system', 'System ready. Configure and start simulation.');
});