const statusEl = document.getElementById('status');
const questionsArea = document.getElementById('questions-area');
const notesEl = document.getElementById('notes');
const attachmentsEl = document.getElementById('attachments');
const sendBtn = document.getElementById('send-btn');
const attachBtn = document.getElementById('attach-btn');
const filePicker = document.getElementById('file-picker');
const dropOverlay = document.getElementById('drop-overlay');

const seenQuestionIds = new Set();
let pendingFiles = [];

function setStatus(connected) {
  statusEl.textContent = connected ? 'connected' : 'disconnected';
  statusEl.classList.toggle('status--connected', connected);
  statusEl.classList.toggle('status--disconnected', !connected);
}

function clearPristinePlaceholder() {
  if (questionsArea.dataset.pristine === 'yes') {
    questionsArea.innerHTML = '';
    questionsArea.dataset.pristine = 'no';
  }
}

function renderQuestionSet({ id, questions, title }) {
  if (seenQuestionIds.has(id)) return;
  seenQuestionIds.add(id);
  clearPristinePlaceholder();

  const form = document.createElement('form');
  form.className = 'question-set';
  form.dataset.id = id;

  if (title) {
    const h = document.createElement('h2');
    h.textContent = title;
    form.appendChild(h);
  }

  for (const q of questions) {
    const field = document.createElement('div');
    field.className = 'field';
    const fieldId = `q-${id}-${q.id}`;

    const label = document.createElement('label');
    label.textContent = q.label;
    label.htmlFor = fieldId;
    field.appendChild(label);

    let input;
    if (q.type === 'textarea') {
      input = document.createElement('textarea');
      input.placeholder = q.placeholder || '';
    } else if (q.type === 'select') {
      input = document.createElement('select');
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = '— choose —';
      blank.disabled = true;
      blank.selected = true;
      input.appendChild(blank);
      (q.options || []).forEach((opt) => {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        input.appendChild(o);
      });
    } else if (q.type === 'multiselect') {
      input = document.createElement('div');
      input.className = 'multiselect';
      (q.options || []).forEach((opt, i) => {
        const row = document.createElement('label');
        row.className = 'check-row';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = opt;
        cb.dataset.multiselect = q.id;
        cb.id = `${fieldId}-${i}`;
        row.appendChild(cb);
        const span = document.createElement('span');
        span.textContent = opt;
        row.appendChild(span);
        input.appendChild(row);
      });
    } else if (q.type === 'number') {
      input = document.createElement('input');
      input.type = 'number';
      input.placeholder = q.placeholder || '';
      if (q.min !== undefined) input.min = q.min;
      if (q.max !== undefined) input.max = q.max;
      if (q.step !== undefined) input.step = q.step;
    } else if (q.type === 'date') {
      input = document.createElement('input');
      input.type = 'date';
    } else if (q.type === 'file') {
      input = document.createElement('input');
      input.type = 'file';
      if (q.accept) input.accept = q.accept;
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.placeholder = q.placeholder || '';
    }

    if (input.tagName !== 'DIV') {
      input.id = fieldId;
      input.name = q.id;
      if (q.required !== false) input.required = true;
    }

    field.appendChild(input);
    form.appendChild(field);
  }

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'primary';
  submit.textContent = 'Submit answers';
  form.appendChild(submit);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const answers = {};
    const files = [];
    for (const q of questions) {
      if (q.type === 'multiselect') {
        const checked = [...form.querySelectorAll(`input[data-multiselect="${q.id}"]:checked`)];
        answers[q.id] = checked.map((c) => c.value);
      } else if (q.type === 'file') {
        const inp = form.querySelector(`#q-${id}-${q.id}`);
        const f = inp && inp.files && inp.files[0];
        if (f) files.push({ fieldname: q.id, file: f });
      } else {
        const inp = form.querySelector(`#q-${id}-${q.id}`);
        answers[q.id] = inp ? inp.value : null;
      }
    }
    submit.disabled = true;
    submit.textContent = 'Submitting…';
    try {
      const fd = new FormData();
      fd.append('id', id);
      fd.append('answers', JSON.stringify(answers));
      for (const { fieldname, file } of files) fd.append(fieldname, file);
      const r = await fetch('/answers', { method: 'POST', body: fd });
      if (!r.ok) throw new Error('server rejected answers');
      submit.textContent = 'Sent ✓';
      form.classList.add('submitted');
    } catch (err) {
      submit.disabled = false;
      submit.textContent = 'Retry submit';
    }
  });

  questionsArea.appendChild(form);
}

// ---- SSE ----
function connectSSE() {
  const es = new EventSource('/events');
  es.addEventListener('open', () => setStatus(true));
  es.addEventListener('error', () => setStatus(false));
  es.addEventListener('questions', (e) => {
    try {
      renderQuestionSet(JSON.parse(e.data));
    } catch (err) { /* malformed event, ignore */ }
  });
}

// ---- Bootstrap (catch anything queued before this tab connected) ----
async function bootstrap() {
  try {
    const r = await fetch('/bootstrap');
    const j = await r.json();
    for (const qs of (j.pending || [])) renderQuestionSet(qs);
  } catch { /* first load; server may not be fully ready */ }
}

// ---- Attachments ----
function renderAttachments() {
  attachmentsEl.innerHTML = '';
  pendingFiles.forEach((f, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';

    if (f.type.startsWith('image/')) {
      const thumb = document.createElement('img');
      thumb.src = URL.createObjectURL(f);
      thumb.alt = f.name;
      chip.appendChild(thumb);
    }

    const name = document.createElement('span');
    name.textContent = `${f.name} (${Math.round(f.size / 1024)}KB)`;
    chip.appendChild(name);

    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.setAttribute('aria-label', 'remove');
    x.addEventListener('click', () => {
      pendingFiles.splice(i, 1);
      renderAttachments();
    });
    chip.appendChild(x);

    attachmentsEl.appendChild(chip);
  });
}

function addFiles(files) {
  for (const f of files) pendingFiles.push(f);
  renderAttachments();
}

// Paste (clipboard images or file objects)
window.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items || [];
  const files = [];
  for (const item of items) {
    if (item.kind === 'file') {
      const f = item.getAsFile();
      if (f) {
        const ext = (f.type.split('/')[1] || 'png').split('+')[0];
        const named = f.name
          ? f
          : new File([f], `pasted-${Date.now()}.${ext}`, { type: f.type });
        files.push(named);
      }
    }
  }
  if (files.length) {
    addFiles(files);
    e.preventDefault();
  }
});

// Drag-and-drop
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  dragDepth++;
  dropOverlay.classList.remove('hidden');
});
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropOverlay.classList.add('hidden');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.classList.add('hidden');
  const files = [...(e.dataTransfer?.files || [])];
  if (files.length) addFiles(files);
});

// File picker
attachBtn.addEventListener('click', () => filePicker.click());
filePicker.addEventListener('change', () => {
  addFiles([...filePicker.files]);
  filePicker.value = '';
});

// Send
sendBtn.addEventListener('click', async () => {
  const note = notesEl.value.trim();
  if (!note && pendingFiles.length === 0) return;
  const fd = new FormData();
  if (note) fd.append('notes', note);
  pendingFiles.forEach((f) => fd.append('files', f));

  sendBtn.disabled = true;
  const original = sendBtn.textContent;
  sendBtn.textContent = 'Sending…';
  try {
    const r = await fetch('/send', { method: 'POST', body: fd });
    if (!r.ok) throw new Error('send failed');
    notesEl.value = '';
    pendingFiles = [];
    renderAttachments();
    sendBtn.textContent = 'Sent ✓';
    setTimeout(() => { sendBtn.textContent = original; sendBtn.disabled = false; }, 1500);
  } catch (err) {
    sendBtn.textContent = 'Error — retry';
    sendBtn.disabled = false;
  }
});

// Go
bootstrap();
connectSSE();
