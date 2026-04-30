import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Pen, Eraser, StickyNote, MousePointer2, Trash2, X, Plus, ChevronLeft, ChevronRight, Users, Loader2, Menu } from 'lucide-react';

// --- YOUR PERSONAL CLOUD SYNC SETUP ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDI-ketAGLq9-OLEs1Tk3xEEoh_QRMmu3c",
  authDomain: "my-jamboard.firebaseapp.com",
  projectId: "my-jamboard",
  storageBucket: "my-jamboard.firebasestorage.app",
  messagingSenderId: "69948235274",
  appId: "1:69948235274:web:d9e58e875c9073e10cc9f3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- Safely Get Initial Board ID ---
const getInitialBoardId = () => {
  try {
    const params = new URLSearchParams(window.location.search);
    const bId = params.get('b');
    if (bId) return bId;
  } catch (e) {
    // Ignore URL errors in strict iframes
  }
  return 'board-' + Math.random().toString(36).substring(2, 10);
};

// --- Constants ---
const PEN_COLORS = ['#000000', '#ef4444', '#3b82f6', '#22c55e', '#eab308'];
const NOTE_COLORS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#fed7aa'];

function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  }
}

function useDebounceCallback(callback, delay) {
  const timeoutRef = useRef(null);
  return useCallback((...args) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => callback(...args), delay);
  }, [callback, delay]);
}

function useFirebaseAuth() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    let isMounted = true;
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        if (isMounted) setUser({ uid: 'guest' });
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (u && isMounted) setUser(u);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return user;
}

function usePagination(user, boardId) {
  const [pageIds, setPageIds] = useState(['default-page']);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!user) return;
    // Reset index when board changes
    setCurrentIndex(0); 
    
    return onSnapshot(doc(db, 'artifacts', boardId, 'public', 'data', 'metadata', 'board'), 
      (docSnap) => {
        if (docSnap.exists() && docSnap.data().pageIds) {
          setPageIds(docSnap.data().pageIds);
        } else {
          setDoc(doc(db, 'artifacts', boardId, 'public', 'data', 'metadata', 'board'), { pageIds: ['default-page'] });
        }
      },
      (err) => console.error("Pagination Sync Error:", err)
    );
  }, [user, boardId]);

  const addPage = useCallback(() => {
    if (!user) return;
    const newId = 'page-' + crypto.randomUUID();
    const newIds = [...pageIds, newId];
    setDoc(doc(db, 'artifacts', boardId, 'public', 'data', 'metadata', 'board'), { pageIds: newIds }, { merge: true });
    setCurrentIndex(newIds.length - 1);
  }, [pageIds, user, boardId]);

  const deletePage = useCallback(() => {
    if (!user || pageIds.length <= 1) return;
    const newIds = pageIds.filter((_, i) => i !== currentIndex);
    setDoc(doc(db, 'artifacts', boardId, 'public', 'data', 'metadata', 'board'), { pageIds: newIds }, { merge: true });
    setCurrentIndex(Math.max(0, currentIndex - 1));
  }, [pageIds, currentIndex, user, boardId]);

  return { pageIds, currentIndex, setCurrentIndex, addPage, deletePage };
}

function useNotes(user, boardId, currentPageId) {
  const [notes, setNotes] = useState([]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(collection(db, 'artifacts', boardId, 'public', 'data', 'notes'), 
      (snap) => setNotes(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      (err) => console.error("Notes Sync Error:", err)
    );
  }, [user, boardId]);

  const currentPageNotes = useMemo(() => notes.filter(n => n.pageId === currentPageId), [notes, currentPageId]);

  const addNote = useCallback((noteData) => {
    if (user) setDoc(doc(db, 'artifacts', boardId, 'public', 'data', 'notes', crypto.randomUUID()), noteData);
  }, [user, boardId]);
  
  const updateNote = useCallback((id, updates) => {
    if (user) setDoc(doc(db, 'artifacts', boardId, 'public', 'data', 'notes', id), updates, { merge: true });
  }, [user, boardId]);
  
  const deleteNote = useCallback((id) => {
    if (user) deleteDoc(doc(db, 'artifacts', boardId, 'public', 'data', 'notes', id));
  }, [user, boardId]);
  
  const clearNotes = useCallback(() => {
    if (user) currentPageNotes.forEach(n => deleteNote(n.id));
  }, [currentPageNotes, deleteNote, user]);

  return { notes: currentPageNotes, addNote, updateNote, deleteNote, clearNotes };
}

function useStrokes(user, boardId, currentPageId) {
  const [strokes, setStrokes] = useState([]);
  const [isSynced, setIsSynced] = useState(false);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(collection(db, 'artifacts', boardId, 'public', 'data', 'strokes'), 
      (snap) => { setStrokes(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setIsSynced(true); },
      (err) => console.error("Strokes Sync Error:", err)
    );
  }, [user, boardId]);

  const currentPageStrokes = useMemo(() => 
    strokes.filter(s => s.pageId === currentPageId).sort((a, b) => a.timestamp - b.timestamp),
  [strokes, currentPageId]);

  const addStroke = useCallback((strokeData) => {
    if (user) setDoc(doc(db, 'artifacts', boardId, 'public', 'data', 'strokes', crypto.randomUUID()), strokeData);
  }, [user, boardId]);
  
  const clearStrokes = useCallback(() => {
    if (user) currentPageStrokes.forEach(s => deleteDoc(doc(db, 'artifacts', boardId, 'public', 'data', 'strokes', s.id)));
  }, [currentPageStrokes, user]);

  return { strokes: currentPageStrokes, isSynced, addStroke, clearStrokes };
}

const CanvasEngine = React.memo(({ strokes, currentTool, penColor, onStrokeComplete, currentPageId }) => {
  const canvasRef = useRef(null);
  const currentLineRef = useRef(null);
  const isDrawingRef = useRef(false);
  
  const toolRef = useRef(currentTool);
  const colorRef = useRef(penColor);
  
  useEffect(() => { toolRef.current = currentTool; }, [currentTool]);
  useEffect(() => { colorRef.current = penColor; }, [penColor]);

  const setupCtx = useCallback((ctx, tool, color) => {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = 30; ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = 4; ctx.strokeStyle = color;
    }
  }, []);

  const redrawBackground = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    strokes.forEach(line => {
      setupCtx(ctx, line.tool, line.color);
      ctx.beginPath();
      if (line.points && line.points.length > 0) {
        ctx.moveTo(line.points[0].x, line.points[0].y);
        for (let i = 1; i < line.points.length; i++) ctx.lineTo(line.points[i].x, line.points[i].y);
        ctx.stroke();
      }
    });
  }, [strokes, setupCtx]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const handleResize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; redrawBackground(); };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [redrawBackground]);

  useEffect(() => { redrawBackground(); }, [redrawBackground]);

  const handlePointerDown = (e) => {
    if (toolRef.current === 'select' || toolRef.current === 'sticky') return;
    isDrawingRef.current = true;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left; const y = e.clientY - rect.top;

    currentLineRef.current = { tool: toolRef.current, color: colorRef.current, pageId: currentPageId, timestamp: Date.now(), points: [{ x, y }] };
    
    const ctx = canvasRef.current.getContext('2d');
    setupCtx(ctx, toolRef.current, colorRef.current);
    ctx.beginPath(); ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
  };

  const handlePointerMove = (e) => {
    if (!isDrawingRef.current || !currentLineRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left; const y = e.clientY - rect.top;

    currentLineRef.current.points.push({ x, y });
    const ctx = canvasRef.current.getContext('2d');
    setupCtx(ctx, toolRef.current, colorRef.current);
    const pts = currentLineRef.current.points;
    if (pts.length >= 2) {
      ctx.beginPath(); ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y); ctx.lineTo(x, y); ctx.stroke();
    }
  };

  const handlePointerUp = () => {
    if (isDrawingRef.current && currentLineRef.current) {
      onStrokeComplete(currentLineRef.current);
      currentLineRef.current = null;
    }
    isDrawingRef.current = false;
  };

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp}
      className={`absolute inset-0 touch-none ${currentTool === 'pen' ? 'cursor-crosshair' : currentTool === 'eraser' ? 'cursor-cell' : 'cursor-default'}`}
      style={{ zIndex: 10 }}
    />
  );
});

const NoteItem = React.memo(({ note, onUpdate, onDelete, onDragStart }) => {
  const [localPos, setLocalPos] = useState({ x: note.x, y: note.y });
  const [isDragging, setIsDragging] = useState(false);
  
  const dragOffset = useRef({ x: 0, y: 0 });
  const currentPosRef = useRef({ x: note.x, y: note.y });

  const [localText, setLocalText] = useState(note.text);
  const [isFocused, setIsFocused] = useState(false);

  const throttledPosUpdate = useMemo(() => throttle((id, pos) => onUpdate(id, pos), 50), [onUpdate]);
  const debouncedTextUpdate = useDebounceCallback((text) => onUpdate(note.id, { text }), 500);

  useEffect(() => { 
    if (!isDragging) {
      setLocalPos({ x: note.x, y: note.y }); 
      currentPosRef.current = { x: note.x, y: note.y };
    }
  }, [note.x, note.y, isDragging]);
  
  useEffect(() => { if (!isFocused) setLocalText(note.text); }, [note.text, isFocused]);

  const handlePointerDown = (e) => {
    e.stopPropagation();
    onDragStart();
    setIsDragging(true);
    const rect = e.currentTarget.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  useEffect(() => {
    if (!isDragging) return;
    
    const handlePointerMove = (e) => {
      const newX = e.clientX - dragOffset.current.x;
      const newY = e.clientY - dragOffset.current.y;
      
      setLocalPos({ x: newX, y: newY });
      currentPosRef.current = { x: newX, y: newY };
      
      throttledPosUpdate(note.id, { x: newX, y: newY }); 
    };
    
    const handlePointerUp = () => {
      setIsDragging(false);
      onUpdate(note.id, currentPosRef.current); 
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => { 
      window.removeEventListener('pointermove', handlePointerMove); 
      window.removeEventListener('pointerup', handlePointerUp); 
    };
  }, [isDragging, note.id, onUpdate, throttledPosUpdate]); 

  return (
    <div
      onPointerDown={handlePointerDown}
      className={`absolute w-48 h-48 p-4 shadow-md flex flex-col pointer-events-auto transition-shadow
        ${isDragging ? 'shadow-2xl cursor-grabbing scale-[1.02]' : 'hover:shadow-lg cursor-grab'}
      `}
      style={{ backgroundColor: note.color, transform: `translate(${localPos.x}px, ${localPos.y}px)`, zIndex: isDragging ? 50 : 10, userSelect: 'none' }}
    >
      <div className="flex justify-between items-start mb-2 opacity-0 hover:opacity-100 transition-opacity">
        <div className="w-full h-4 cursor-grab active:cursor-grabbing" />
        <button onClick={(e) => { e.stopPropagation(); onDelete(note.id); }} className="p-1 hover:bg-black/10 rounded-full text-black/50 hover:text-black transition-colors"><X size={16} /></button>
      </div>
      <textarea
        className="w-full h-full bg-transparent border-none resize-none outline-none text-gray-800 text-lg leading-snug placeholder:text-gray-800/40"
        placeholder="Type something..." value={localText}
        onChange={(e) => { setLocalText(e.target.value); debouncedTextUpdate(e.target.value); }}
        onFocus={() => setIsFocused(true)} onBlur={() => setIsFocused(false)}
        onPointerDown={(e) => e.stopPropagation()} 
      />
    </div>
  );
});

function IconButton({ icon, isActive, onClick, title, colorClass = "text-gray-500 hover:text-gray-900 hover:bg-gray-100" }) {
  return (
    <button onClick={onClick} title={title} className={`p-3 rounded-xl transition-all duration-200 flex items-center justify-center ${isActive ? 'bg-blue-50 text-blue-600 shadow-sm' : colorClass}`}>
      {icon}
    </button>
  );
}

// ============================================================================
// MAIN APPLICATION LAYOUT
// ============================================================================

export default function App() {
  const [boardId, setBoardId] = useState(getInitialBoardId());
  const user = useFirebaseAuth();
  
  // Safely update the URL when boardId changes (if allowed by environment)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('b') !== boardId) {
        window.history.replaceState(null, '', `?b=${boardId}`);
      }
    } catch (e) {
      // Ignore in restricted iframes
    }
  }, [boardId]);
  
  const { pageIds, currentIndex, setCurrentIndex, addPage, deletePage } = usePagination(user, boardId);
  const currentPageId = pageIds[currentIndex] || 'default-page';

  const { notes, addNote, updateNote, deleteNote, clearNotes } = useNotes(user, boardId, currentPageId);
  const { strokes, isSynced, addStroke, clearStrokes } = useStrokes(user, boardId, currentPageId);

  const [currentTool, setCurrentTool] = useState('pen');
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [noteColor, setNoteColor] = useState(NOTE_COLORS[0]);

  // Dashboard State
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [recentBoards, setRecentBoards] = useState([]);

  // Track boards in local storage
  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem('my_jamboards') || '[]');
    if (!saved.find(b => b.id === boardId)) {
      saved.unshift({ id: boardId, name: `Board ${saved.length + 1}`, date: Date.now() });
      localStorage.setItem('my_jamboards', JSON.stringify(saved));
    }
    setRecentBoards(saved);
  }, [boardId]);

  const handleNewBoard = () => {
    const newId = 'board-' + Math.random().toString(36).substring(2, 10);
    setBoardId(newId);
    setIsMenuOpen(false);
  };

  const handleLoadBoard = (id) => {
    setBoardId(id);
    setIsMenuOpen(false);
  };

  const handleBackgroundClick = useCallback((e) => {
    if (currentTool === 'sticky' && user) {
      addNote({ x: e.clientX - 100, y: e.clientY - 100, text: '', color: noteColor, pageId: currentPageId, timestamp: Date.now() });
      setCurrentTool('select');
    }
  }, [currentTool, addNote, noteColor, currentPageId, user]);

  if (!user) {
    return (
      <div className="flex items-center justify-center w-full h-screen bg-[#f8f9fa] text-gray-500 font-sans">
        <Loader2 className="animate-spin mr-3 text-blue-500" size={28} /> 
        <span className="font-medium text-lg">Connecting to Workspace...</span>
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#f8f9fa] font-sans selection:bg-blue-200" onPointerDown={handleBackgroundClick}>
      
      {/* 1. Pure Canvas Layer */}
      <CanvasEngine 
        strokes={strokes} currentTool={currentTool} penColor={penColor} 
        currentPageId={currentPageId} onStrokeComplete={addStroke} 
      />

      {/* 2. Sticky Notes Layer */}
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 20 }}>
        {notes.map(note => (
          <NoteItem 
            key={note.id} note={note} onUpdate={updateNote} onDelete={deleteNote} 
            onDragStart={() => setCurrentTool('select')}
          />
        ))}
      </div>

      {/* 3. Dashboard / Hamburger Menu */}
      <div className="absolute top-6 left-6 z-40 flex items-center gap-2">
        <button 
          onClick={() => setIsMenuOpen(true)}
          className="p-3 bg-white/90 backdrop-blur-md rounded-xl shadow-sm border border-gray-200 hover:bg-gray-50 transition-colors pointer-events-auto"
        >
          <Menu size={20} className="text-gray-700" />
        </button>
        <div className="bg-white/90 backdrop-blur-md px-4 py-2.5 rounded-xl shadow-sm border border-gray-200 pointer-events-auto flex items-center gap-2">
           <div className={`w-3 h-3 rounded-full ${isSynced ? 'bg-green-500' : 'bg-yellow-400 animate-pulse'}`} />
           <span className="font-semibold text-gray-700">My Jamboard</span>
        </div>
      </div>

      {/* Slide-out Sidebar */}
      {isMenuOpen && (
        <div className="fixed inset-0 z-50 flex pointer-events-auto">
          <div className="w-72 bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-left duration-200">
            <div className="p-5 flex justify-between items-center border-b">
              <h2 className="font-bold text-lg text-gray-800">My Boards</h2>
              <button onClick={() => setIsMenuOpen(false)} className="p-2 hover:bg-gray-100 rounded-full"><X size={20}/></button>
            </div>
            <div className="p-4 border-b bg-gray-50">
              <button onClick={handleNewBoard} className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 flex justify-center items-center gap-2 shadow-sm">
                <Plus size={18} /> Create New Board
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {recentBoards.map(b => (
                <button 
                  key={b.id} 
                  onClick={() => handleLoadBoard(b.id)} 
                  className={`w-full text-left p-4 hover:bg-gray-50 border-b flex flex-col gap-1 transition-colors ${b.id === boardId ? 'bg-blue-50/50 border-l-4 border-l-blue-600' : 'border-l-4 border-l-transparent'}`}
                >
                  <div className="font-semibold text-gray-800">{b.name}</div>
                  <div className="text-xs text-gray-500 font-medium">Last opened: {new Date(b.date).toLocaleDateString()}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 bg-black/20 backdrop-blur-sm" onClick={() => setIsMenuOpen(false)}></div>
        </div>
      )}

      {/* 4. Pagination UI */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-md px-3 py-2 rounded-xl shadow-sm border border-gray-200 pointer-events-auto flex items-center gap-2 z-30">
        <button onClick={() => setCurrentIndex(p => Math.max(0, p - 1))} disabled={currentIndex === 0} className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors"><ChevronLeft size={20} /></button>
        <span className="text-sm font-semibold text-gray-600 min-w-[50px] text-center">{currentIndex + 1} / {pageIds.length}</span>
        <button onClick={() => setCurrentIndex(p => Math.min(pageIds.length - 1, p + 1))} disabled={currentIndex === pageIds.length - 1} className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors"><ChevronRight size={20} /></button>
        <div className="w-px h-6 bg-gray-200 mx-1" />
        <button onClick={addPage} className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors flex items-center gap-1 text-sm font-bold pr-3"><Plus size={18} /> Add Frame</button>
        
        {/* Delete Page Button */}
        {pageIds.length > 1 && (
          <>
            <div className="w-px h-6 bg-gray-200 mx-1" />
            <button onClick={deletePage} title="Delete This Frame" className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors flex items-center gap-1 text-sm font-bold pr-2"><Trash2 size={18} /></button>
          </>
        )}
      </div>

      {/* 5. Toolbar UI */}
      <div className="absolute left-6 top-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-xl border border-gray-200 p-2 flex flex-col gap-2 pointer-events-auto z-30">
        <IconButton icon={<MousePointer2 size={24} />} isActive={currentTool === 'select'} onClick={() => setCurrentTool('select')} title="Select" />
        <IconButton icon={<Pen size={24} />} isActive={currentTool === 'pen'} onClick={() => setCurrentTool('pen')} title="Pen" />
        <IconButton icon={<Eraser size={24} />} isActive={currentTool === 'eraser'} onClick={() => setCurrentTool('eraser')} title="Eraser" />
        <IconButton icon={<StickyNote size={24} />} isActive={currentTool === 'sticky'} onClick={() => setCurrentTool('sticky')} title="Sticky Note" />
        
        <div className="w-full h-px bg-gray-100 my-1" />

        {(currentTool === 'pen' || currentTool === 'select') && (
          <div className="flex flex-col gap-2 p-1">
            {PEN_COLORS.map(color => (
              <button key={color} className={`w-8 h-8 rounded-full border-2 transition-transform ${penColor === color ? 'border-gray-800 scale-110' : 'border-transparent hover:scale-110'}`} style={{ backgroundColor: color }} onClick={() => { setPenColor(color); setCurrentTool('pen'); }} />
            ))}
          </div>
        )}

        {currentTool === 'sticky' && (
          <div className="flex flex-col gap-2 p-1">
            {NOTE_COLORS.map(color => (
              <button key={color} className={`w-8 h-8 rounded-sm shadow-sm border-2 transition-transform ${noteColor === color ? 'border-gray-800 scale-110' : 'border-gray-200 hover:scale-110'}`} style={{ backgroundColor: color }} onClick={() => setNoteColor(color)} />
            ))}
          </div>
        )}

        <div className="w-full h-px bg-gray-100 my-1" />
        <IconButton icon={<Trash2 size={24} />} onClick={() => { clearNotes(); clearStrokes(); }} title="Clear Page" colorClass="text-red-500 hover:bg-red-50" />
      </div>

    </div>
  );
}