/* ============================================================
   main.js — 27-may-2025  ✨  Chat IA integrado con sensores activos
   ------------------------------------------------------------
   • El formulario de “nuevo sensor” sigue igual.
   • El chat envía { question, sensores } a /api/chat
     → El backend (Node/Flask) llama a OpenAI y responde {answer:"…"}
   ============================================================ */

/* ---------- Alta de sensor (sin cambios) ---------- */
document.getElementById('form-sensor').addEventListener('submit', async e => {
    e.preventDefault();
  
    const fd = new FormData();
    fd.append('fecha-inicio', document.getElementById('fecha-inicio').value);
    fd.append('fecha-recogida', document.getElementById('fecha-recogida').value);
    fd.append('latitud',        document.getElementById('latitud').value);
    fd.append('longitud',       document.getElementById('longitud').value);
  
    const imgInp = document.getElementById('imagen');
    if (imgInp.files.length) fd.append('imagen', imgInp.files[0]);
  
    try{
      const r = await fetch('/api/sensores', { method:'POST', body:fd });
      if (!r.ok) throw new Error('Error al registrar sensor');
      alert('Sensor registrado correctamente');
      document.getElementById('form-sensor').reset();
      loadSensors?.();                       // vuelve a pintar mapa si existe esa fn
    }catch(err){
      console.error(err);
      alert('Error al registrar el sensor');
    }
  });
  
  /* ---------- Chat IA ---------- */
  const chatMessages = document.getElementById('chat-messages');
  const chatInput    = document.getElementById('chat-input');
  
  function addMessage(role, text){
    const div = document.createElement('div');
    div.className = `mb-2 text-${role==='user'?'end':'start'}`;
    div.innerHTML = `<span class="badge bg-${role==='user'?'primary':'secondary'}">${text}</span>`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
  
  async function askAI(question){
    // 1. Obtiene la lista filtrada vigente del mapa
    const sensores = window.getActiveSensors?.() ?? [];
  
    // 2. Muestra spinner en el chat (opcional)
    const waiting = addMessage('assistant', '…');
  
    try{
      const resp = await fetch('/api/chat', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ question, sensores })
      });
      const data = await resp.json();
      waiting.remove();                                 // quita “…”
  
      addMessage('assistant', data.answer || '⚠️ Sin respuesta');
    }catch(err){
      console.error(err);
      waiting.remove();
      addMessage('assistant', '💥 Error al consultar la IA');
    }
  }
  
  /* ---------- Listeners ---------- */
  chatInput.addEventListener('keypress', async e => {
    if (e.key === 'Enter' && chatInput.value.trim()){
      const msg = chatInput.value.trim();
      addMessage('user', msg);
      chatInput.value = '';
      await askAI(msg);
    }
  });
  
  document.getElementById('chat-send').addEventListener('click', () => {
    const evt = new KeyboardEvent('keypress', { key:'Enter' });
    chatInput.dispatchEvent(evt);
  });
  
  /* ---------- Export helper ---------- */
  window.showSensorDetails = showSensorDetails;   // si tu HTML la usa
  