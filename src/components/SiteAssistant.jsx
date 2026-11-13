import { useEffect, useRef, useState } from 'react';
import { Drawer } from 'vaul';
import '../styles/assistant.css';

const positionKey = 'agua-assistant-position';
const starters = ['Quiero buscar un equipo', '¿Cómo publico un equipo?'];
const clamp = value => Math.min(.92, Math.max(.16, value));

function Sparkles() {
  return <svg aria-hidden="true" width="25" height="25" viewBox="0 0 24 24" fill="currentColor">
    <path d="M10 2c.9 4.7 2.3 6.1 7 7-4.7.9-6.1 2.3-7 7-.9-4.7-2.3-6.1-7-7 4.7-.9 6.1-2.3 7-7Zm8 10c.5 2.8 1.2 3.5 4 4-2.8.5-3.5 1.2-4 4-.5-2.8-1.2-3.5-4-4 2.8-.5 3.5-1.2 4-4Z" />
  </svg>;
}

export default function SiteAssistant() {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(.88);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const gesture = useRef(null);
  const suppressClick = useRef(false);
  const activeRequest = useRef(null);
  const transcript = useRef(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(positionKey);
      if (saved && Number.isFinite(Number(saved))) setPosition(clamp(Number(saved)));
    } catch {}
    return () => activeRequest.current?.abort();
  }, []);

  useEffect(() => {
    const region = transcript.current;
    if (region) region.scrollTop = region.scrollHeight;
  }, [open, messages, pending, error]);

  function remember(value) {
    setPosition(value);
    try { localStorage.setItem(positionKey, String(value)); } catch {}
  }

  function move(event) {
    const current = gesture.current;
    if (current?.id !== event.pointerId) return;
    const delta = event.clientY - current.y;
    if (!current.moved) {
      if (Math.abs(delta) < 6) return;
      current.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setPosition(clamp(current.position + delta / window.innerHeight));
  }

  function finish(event) {
    const current = gesture.current;
    if (current?.id !== event.pointerId) return;
    suppressClick.current = current.moved;
    gesture.current = null;
    if (current.moved) remember(clamp(current.position + (event.clientY - current.y) / window.innerHeight));
  }

  async function send(value) {
    const content = value.trim();
    if (!content || activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    const user = { role: 'user', content };
    const history = [...messages.slice(-6), user].map(({ role, content }) => ({ role, content }));
    setDraft('');
    setError('');
    setPending(content);
    try {
      const response = await fetch('/api/asistente', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: controller.signal, body: JSON.stringify({ messages: history }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error || 'No pudimos responder. Volvé a intentar.');
        setDraft(content);
        return;
      }
      setMessages(previous => [...previous, user, { role: 'assistant', content: result.answer, ...result }]);
    } catch {
      if (!controller.signal.aborted) {
        setError('No pudimos conectar. Volvé a intentar.');
        setDraft(content);
      }
    } finally {
      activeRequest.current = null;
      if (!controller.signal.aborted) setPending('');
    }
  }

  return <Drawer.Root open={open} onOpenChange={setOpen} direction="bottom" handleOnly repositionInputs={false}>
    <Drawer.Trigger className="assistant-trigger" type="button"
      aria-label="Abrir asistente de Aguamáquinas" title="Asistente de Aguamáquinas"
      style={{ '--assistant-position': (position * 100) + '%' }}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        suppressClick.current = false;
        gesture.current = { id: event.pointerId, y: event.clientY, position, moved: false };
      }}
      onPointerMove={move} onPointerUp={finish}
      onPointerLeave={() => {
        if (!gesture.current?.moved) gesture.current = null;
      }}
      onPointerCancel={() => {
        if (gesture.current) setPosition(gesture.current.position);
        gesture.current = null;
      }}
      onClick={event => {
        if (event.detail && suppressClick.current) event.preventDefault();
        suppressClick.current = false;
      }}
      onKeyDown={event => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        remember(clamp(position + (event.key === 'ArrowUp' ? -.05 : .05)));
      }}>
      <Sparkles />
    </Drawer.Trigger>
    <Drawer.Portal>
      <Drawer.Overlay className="assistant-overlay" />
      <Drawer.Content className="assistant-drawer">
        <Drawer.Handle className="assistant-handle" />
        <header className="assistant-header">
          <Drawer.Close className="assistant-close" aria-label="Cerrar asistente">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m14 6-6 6 6 6" /></svg>
          </Drawer.Close>
          <Sparkles />
          <Drawer.Title className="visually-hidden">Asistente de Aguamáquinas</Drawer.Title>
          <Drawer.Description className="visually-hidden">Consultá por equipos o preguntá cómo publicar.</Drawer.Description>
        </header>
        <div className="assistant-transcript" ref={transcript} role="log" aria-label="Conversación">
          {!messages.length && !pending && <div className="assistant-starters">
            {starters.map(question => <button type="button" key={question} onClick={() => send(question)}>
              <span className="assistant-starter-icon"><Sparkles /></span>{question}
            </button>)}
          </div>}
          {messages.map((entry, index) => <div className={'assistant-bubble assistant-' + entry.role} key={index}>
            <p>{entry.content}</p>
            {entry.links?.length > 0 && <ul>{entry.links.map(link =>
              <li key={link.href}><a href={link.href} onClick={() => setOpen(false)}>{link.title}</a></li>)}</ul>}
          </div>)}
          {pending && <><div className="assistant-bubble assistant-user"><p>{pending}</p></div><p role="status">Buscando información…</p></>}
          {error && <p role="alert">{error}</p>}
        </div>
        <form className="assistant-form" onSubmit={event => { event.preventDefault(); void send(draft); }}>
          <input aria-label="Tu consulta" value={draft} maxLength={700} onChange={event => setDraft(event.target.value)} placeholder="Escribí tu consulta" />
          <button type="submit" aria-label="Enviar" disabled={Boolean(pending) || !draft.trim()}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>
          </button>
        </form>
        <div className="assistant-footer">
          <span>Asistente con IA. Evitá compartir datos personales.</span>
        </div>
      </Drawer.Content>
    </Drawer.Portal>
  </Drawer.Root>;
}
