import { useState, useEffect, useRef, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { GoogleGenAI } from '@google/genai';
import { 
  BookOpen, Settings, Sparkles, Crown, 
  Palette, Send, Loader2, Lock, Check, 
  Library, Home as HomeIcon, ChevronRight,
  Clock, FileText, Type, Search, Sliders, LogIn, LogOut, User
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { auth, db, loginWithGoogle, logout } from './firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, doc, setDoc, getDoc, onSnapshot, query, orderBy, serverTimestamp, addDoc, where } from 'firebase/firestore';

// --- Utils ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types & Constants ---
const THEMES = [
  { id: 'dark', name: 'Тёмная', desc: 'Стильная и современная' },
  { id: 'light', name: 'Светлая', desc: 'Чистая и минималистичная' },
  { id: 'book', name: 'Книжная', desc: 'Теплая, как старый пергамент' },
  { id: 'midnight', name: 'Полночь', desc: 'Глубокие синие оттенки' },
  { id: 'forest', name: 'Лес', desc: 'Спокойные зеленые тона' },
  { id: 'mocha', name: 'Мокко', desc: 'Уютная кофейная тема' },
  { id: 'rose', name: 'Роза', desc: 'Нежная и светлая' },
  { id: 'nord', name: 'Норд', desc: 'Холодная арктическая' },
];

const FONTS = [
  { id: 'font-sans', name: 'Inter', desc: 'Современный без засечек' },
  { id: 'font-serif', name: 'Playfair', desc: 'Элегантный с засечками' },
  { id: 'font-book', name: 'Merriweather', desc: 'Классический книжный' },
  { id: 'font-lora', name: 'Lora', desc: 'Мягкий с засечками' },
  { id: 'font-nunito', name: 'Nunito', desc: 'Округлый и дружелюбный' },
  { id: 'font-oswald', name: 'Oswald', desc: 'Узкий и строгий' },
  { id: 'font-mono', name: 'JetBrains', desc: 'Моноширинный код' },
  { id: 'font-fira', name: 'Fira Code', desc: 'Альтернативный код' },
  { id: 'font-handwriting', name: 'Caveat', desc: 'Рукописный стиль' },
];

const MAX_AUTH_GENERATIONS = 2;

interface Story {
  id: string;
  title: string;
  content: string;
  date: string;
  fandom: string;
}

// --- Global State Management (Context) ---
interface AppContextType {
  theme: string;
  font: string;
  accentColor: string | null;
  textSize: number;
  generationsLeft: number;
  stories: Story[];
  user: FirebaseUser | null;
  isAuthReady: boolean;
  updateTheme: (t: string) => void;
  updateFont: (f: string) => void;
  updateAccentColor: (c: string | null) => void;
  updateTextSize: (s: number) => void;
  useGeneration: () => Promise<void>;
  saveStory: (story: Omit<Story, 'id' | 'date'>) => Promise<void>;
}

const AppContext = createContext<AppContextType | null>(null);

function useAppStore() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppStore must be used within AppProvider');
  return context;
}

function AppProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState('dark');
  const [font, setFont] = useState('font-sans');
  const [accentColor, setAccentColor] = useState<string | null>(null);
  const [textSize, setTextSize] = useState<number>(18);
  const [generationsLeft, setGenerationsLeft] = useState(0);
  const [stories, setStories] = useState<Story[]>([]);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // Local storage for UI settings
  useEffect(() => {
    const savedTheme = localStorage.getItem('crolff-theme') || 'dark';
    const savedFont = localStorage.getItem('crolff-font') || 'font-sans';
    const savedColor = localStorage.getItem('crolff-color');
    const savedSize = localStorage.getItem('crolff-textsize');
    
    setTheme(savedTheme);
    setFont(savedFont);
    if (savedColor) setAccentColor(savedColor);
    if (savedSize) setTextSize(Number(savedSize));
    
    document.documentElement.setAttribute('data-theme', savedTheme);
  }, []);

  // Auth & Firestore sync
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);

      if (currentUser) {
        // Sync user profile
        const userRef = doc(db, 'users', currentUser.uid);
        try {
          const userSnap = await getDoc(userRef);
          const today = new Date().toDateString();

          if (!userSnap.exists()) {
            await setDoc(userRef, {
              uid: currentUser.uid,
              email: currentUser.email,
              displayName: currentUser.displayName,
              photoURL: currentUser.photoURL,
              generationsUsed: 0,
              lastGenerationDate: today
            });
            setGenerationsLeft(MAX_AUTH_GENERATIONS);
          } else {
            const data = userSnap.data();
            if (data.lastGenerationDate !== today) {
              await setDoc(userRef, { generationsUsed: 0, lastGenerationDate: today }, { merge: true });
              setGenerationsLeft(MAX_AUTH_GENERATIONS);
            } else {
              setGenerationsLeft(Math.max(0, MAX_AUTH_GENERATIONS - (data.generationsUsed || 0)));
            }
          }
        } catch (error) {
          console.error("Firestore user sync error:", error);
        }
      } else {
        setGenerationsLeft(0);
        const savedStories = JSON.parse(localStorage.getItem('crolff-stories') || '[]');
        setStories(savedStories);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  // Stories sync
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'stories'), where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedStories: Story[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        fetchedStories.push({
          id: doc.id,
          title: data.title,
          fandom: data.fandom,
          content: data.content,
          date: data.date || new Date().toLocaleDateString(),
          createdAt: data.createdAt?.toMillis() || Date.now()
        } as any);
      });
      
      // Sort client-side to avoid requiring a composite index in Firestore
      fetchedStories.sort((a: any, b: any) => b.createdAt - a.createdAt);
      
      setStories(fetchedStories);
    }, (error) => {
      console.error("Firestore onSnapshot error:", error);
    });
    return () => unsubscribe();
  }, [user]);

  const updateTheme = (newTheme: string) => {
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('crolff-theme', newTheme);
  };

  const updateFont = (newFont: string) => {
    setFont(newFont);
    localStorage.setItem('crolff-font', newFont);
  };

  const updateAccentColor = (color: string | null) => {
    setAccentColor(color);
    if (color) localStorage.setItem('crolff-color', color);
    else localStorage.removeItem('crolff-color');
  };

  const updateTextSize = (size: number) => {
    setTextSize(size);
    localStorage.setItem('crolff-textsize', size.toString());
  };

  const useGeneration = async () => {
    if (user) {
      try {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const data = userSnap.data();
          const newUsed = (data.generationsUsed || 0) + 1;
          await setDoc(userRef, { generationsUsed: newUsed }, { merge: true });
          setGenerationsLeft(Math.max(0, MAX_AUTH_GENERATIONS - newUsed));
        }
      } catch (error) {
        console.error("Error updating generations:", error);
      }
    }
  };

  const saveStory = async (storyData: Omit<Story, 'id' | 'date'>) => {
    const dateStr = new Date().toLocaleDateString();
    if (user) {
      try {
        await addDoc(collection(db, 'stories'), {
          ...storyData,
          userId: user.uid,
          date: dateStr,
          createdAt: serverTimestamp()
        });
      } catch (error) {
        console.error("Error saving story:", error);
      }
    } else {
      const newStory: Story = { ...storyData, id: Date.now().toString(), date: dateStr };
      const newStories = [newStory, ...stories];
      setStories(newStories);
      localStorage.setItem('crolff-stories', JSON.stringify(newStories));
    }
  };

  return (
    <AppContext.Provider value={{
      theme, font, accentColor, textSize, generationsLeft, stories, user, isAuthReady,
      updateTheme, updateFont, updateAccentColor, updateTextSize, useGeneration, saveStory
    }}>
      {children}
    </AppContext.Provider>
  );
}

// --- Components ---

function Navbar({ generationsLeft }: { generationsLeft: number }) {
  const location = useLocation();
  const { user } = useAppStore();
  
  const navItems = [
    { path: '/', icon: HomeIcon, label: 'Главная' },
    { path: '/create', icon: Sparkles, label: 'Создать' },
    { path: '/search', icon: Search, label: 'Поиск' },
    { path: '/library', icon: Library, label: 'Библиотека' },
    { path: '/settings', icon: Settings, label: 'Настройки' },
  ];

  return (
    <header className="sticky top-0 z-40 w-full backdrop-blur-xl bg-bg-main/80 border-b border-border-main">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 group">
          <div className="bg-primary-main/10 p-2 rounded-xl group-hover:bg-primary-main/20 transition-colors">
            <BookOpen className="w-5 h-5 text-primary-main" />
          </div>
          <span className="text-xl font-bold tracking-tight">CrolFF</span>
        </Link>
        
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                  isActive 
                    ? "bg-panel-hover text-text-main" 
                    : "text-text-muted hover:text-text-main hover:bg-panel-main"
                )}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          {user && (
            <div className="hidden sm:flex items-center gap-2 text-sm">
              <span className={cn(
                "font-semibold px-3 py-1.5 rounded-lg border",
                generationsLeft > 0 
                  ? "bg-primary-main/10 text-primary-main border-primary-main/20" 
                  : "bg-red-500/10 text-red-500 border-red-500/20"
              )}>
                {generationsLeft} / {MAX_AUTH_GENERATIONS} <span className="hidden lg:inline font-normal opacity-80">генераций</span>
              </span>
            </div>
          )}
          
          {user ? (
            <div className="flex items-center gap-2">
              <img src={user.photoURL || ''} alt="Profile" className="w-8 h-8 rounded-full border border-border-main" />
              <button 
                onClick={logout}
                className="p-2 text-text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                title="Выйти"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button 
              onClick={async () => {
                try {
                  await loginWithGoogle();
                } catch (error: any) {
                  if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
                    console.error('Login error:', error);
                    alert('Ошибка при входе. Попробуйте еще раз.');
                  }
                }
              }}
              className="flex items-center gap-2 bg-panel-main border border-border-main text-text-main px-3 py-2 rounded-lg font-medium hover:bg-panel-hover transition-colors text-sm"
            >
              <LogIn className="w-4 h-4" />
              <span className="hidden sm:inline">Войти</span>
            </button>
          )}
        </div>
      </div>
      
      {/* Mobile Nav */}
      <div className="md:hidden border-t border-border-main bg-bg-main flex justify-around p-2 overflow-x-auto">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex flex-col items-center gap-1 p-2 rounded-lg text-xs font-medium transition-all min-w-[64px]",
                isActive ? "text-primary-main" : "text-text-muted"
              )}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </header>
  );
}

// --- Pages ---

function HomePage() {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-20 text-center space-y-8"
    >
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary-main/10 text-primary-main text-sm font-medium mb-4 border border-primary-main/20">
        <Sparkles className="w-4 h-4" />
        <span>ИИ-писатель нового поколения</span>
      </div>
      
      <h1 className="text-5xl md:text-7xl font-bold tracking-tight max-w-3xl leading-tight">
        Бесконечные миры <br/>
        <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-main to-purple-500">
          по вашим правилам
        </span>
      </h1>
      
      <p className="text-lg text-text-muted max-w-2xl leading-relaxed">
        CrolFF — это платформа, где вы задаете идею, а нейросеть пишет длинную, детальную и захватывающую историю. Любые фэндомы, любые персонажи, полная свобода.
      </p>
      
      <div className="flex flex-col sm:flex-row gap-4 pt-8">
        <Link 
          to="/create" 
          className="bg-primary-main hover:bg-primary-hover text-white px-8 py-4 rounded-xl font-medium transition-all flex items-center justify-center gap-2 text-lg shadow-lg shadow-primary-main/25"
        >
          Начать писать <ChevronRight className="w-5 h-5" />
        </Link>
        <Link 
          to="/library" 
          className="bg-panel-main hover:bg-panel-hover border border-border-main text-text-main px-8 py-4 rounded-xl font-medium transition-all flex items-center justify-center gap-2 text-lg"
        >
          <Library className="w-5 h-5" /> Читать библиотеку
        </Link>
      </div>
    </motion.div>
  );
}

function CreatePage({ generationsLeft, useGeneration, saveStory, textSize, user }: any) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [story, setStory] = useState(() => localStorage.getItem('crolff-draft-story') || '');
  const [fandom, setFandom] = useState(() => localStorage.getItem('crolff-draft-fandom') || '');
  const [characters, setCharacters] = useState(() => localStorage.getItem('crolff-draft-characters') || '');
  const [plot, setPlot] = useState(() => localStorage.getItem('crolff-draft-plot') || '');
  const [tone, setTone] = useState(() => localStorage.getItem('crolff-draft-tone') || 'Сбалансированный');
  const [keywords, setKeywords] = useState(() => localStorage.getItem('crolff-draft-keywords') || '');
  const navigate = useNavigate();
  const storyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('crolff-draft-story', story);
    localStorage.setItem('crolff-draft-fandom', fandom);
    localStorage.setItem('crolff-draft-characters', characters);
    localStorage.setItem('crolff-draft-plot', plot);
    localStorage.setItem('crolff-draft-tone', tone);
    localStorage.setItem('crolff-draft-keywords', keywords);
  }, [story, fandom, characters, plot, tone, keywords]);

  const generateStory = async () => {
    if (!user) {
      alert('Только зарегистрированные пользователи могут генерировать истории. Пожалуйста, войдите в аккаунт.');
      return;
    }

    if (generationsLeft <= 0) {
      alert('Лимит генераций на сегодня исчерпан. Возвращайтесь завтра!');
      return;
    }

    if (!fandom && !characters && !plot) {
      alert('Пожалуйста, заполните хотя бы несколько полей!');
      return;
    }

    setIsGenerating(true);
    setStory('');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `
        Ты — гениальный писатель-романист. Напиши ОЧЕНЬ длинный, невероятно детализированный фанфик.
        Не торопи события. Описывай окружение, мысли героев, эмоции.
        Минимальный объем — 1500-2000 слов.
        
        Параметры:
        Фэндом: ${fandom || 'Оригинальный мир'}
        Персонажи: ${characters || 'На твое усмотрение'}
        Сюжет: ${plot || 'Придумай захватывающую завязку.'}
        Тон повествования: ${tone}
        Ключевые слова/детали (обязательно вплести в сюжет): ${keywords || 'Нет'}
        
        Пиши на русском языке. Литературный слог.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      const text = response.text || 'Ошибка генерации.';
      setStory(text);
      useGeneration();
      
      const title = fandom ? `${fandom} - История` : 'Оригинальная история';
      saveStory({
        id: Date.now().toString(),
        title,
        fandom: fandom || 'Оригинал',
        content: text,
        date: new Date().toLocaleDateString()
      });

      setTimeout(() => {
        storyRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);

    } catch (error) {
      console.error(error);
      setStory('Произошла ошибка при обращении к нейросети.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 py-8">
      <div className="text-center space-y-2">
        <h2 className="text-3xl font-bold">Создать историю</h2>
        <p className="text-text-muted">Опишите свою идею, и ИИ воплотит её в жизнь.</p>
      </div>

      <div className="bg-panel-main border border-border-main rounded-2xl p-6 md:p-8 shadow-sm">
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-text-muted">Фэндом или Сеттинг</label>
              <input 
                type="text" 
                value={fandom}
                onChange={(e) => setFandom(e.target.value)}
                placeholder="Гарри Поттер, Киберпанк..."
                className="w-full bg-bg-main border border-border-main rounded-xl px-4 py-3 outline-none focus:border-primary-main focus:ring-1 focus:ring-primary-main transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-text-muted">Персонажи / Пейринг</label>
              <input 
                type="text" 
                value={characters}
                onChange={(e) => setCharacters(e.target.value)}
                placeholder="Имена главных героев..."
                className="w-full bg-bg-main border border-border-main rounded-xl px-4 py-3 outline-none focus:border-primary-main focus:ring-1 focus:ring-primary-main transition-all"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-text-muted">Сюжет и пожелания</label>
            <textarea 
              value={plot}
              onChange={(e) => setPlot(e.target.value)}
              placeholder="Что должно произойти? Опишите завязку или атмосферу..."
              rows={4}
              className="w-full bg-bg-main border border-border-main rounded-xl px-4 py-3 outline-none focus:border-primary-main focus:ring-1 focus:ring-primary-main transition-all resize-none"
            />
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium text-text-muted">Тон повествования</label>
            <div className="flex flex-wrap gap-2">
              {['Сбалансированный', 'Драма / Ангст', 'Юмор / Комедия', 'Романтика / Флафф', 'Хоррор / Дарк', 'Экшен / Приключения'].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTone(t)}
                  className={cn(
                    "px-4 py-2 rounded-xl text-sm font-medium transition-all border",
                    tone === t 
                      ? "bg-primary-main/10 border-primary-main text-primary-main shadow-sm" 
                      : "bg-bg-main border-border-main text-text-muted hover:border-text-muted hover:text-text-main"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-text-muted">Ключевые слова (через запятую)</label>
            <input 
              type="text" 
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="кулон, дождь, предательство..."
              className="w-full bg-bg-main border border-border-main rounded-xl px-4 py-3 outline-none focus:border-primary-main focus:ring-1 focus:ring-primary-main transition-all"
            />
          </div>

          <button
            onClick={generateStory}
            disabled={isGenerating}
            className="w-full bg-text-main text-bg-main hover:opacity-90 font-medium py-4 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGenerating ? (
              <><Loader2 className="w-5 h-5 animate-spin" /> Пишем шедевр...</>
            ) : !user ? (
              <><LogOut className="w-5 h-5 rotate-180" /> Войдите, чтобы писать</>
            ) : (
              <><Send className="w-5 h-5" /> Сгенерировать ({generationsLeft} осталось)</>
            )}
          </button>
        </div>
      </div>

      {(story || isGenerating) && (
        <div ref={storyRef} className="bg-panel-main border border-border-main rounded-2xl p-8 shadow-sm min-h-[400px]">
          {isGenerating ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-20">
              <Loader2 className="w-10 h-10 animate-spin text-primary-main mb-4" />
              <h3 className="text-lg font-medium">Нейросеть творит магию...</h3>
              <p className="text-text-muted mt-2">Текст будет очень длинным, подождите немного.</p>
            </div>
          ) : (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="prose max-w-none dark:prose-invert"
              style={{ color: 'var(--text-color)' }}
            >
              <div className="markdown-body leading-relaxed" style={{ fontSize: `${textSize}px` }}>
                <Markdown>{story}</Markdown>
              </div>
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}

function LibraryPage({ stories }: { stories: Story[] }) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredStories = stories.filter(story => {
    const q = searchQuery.toLowerCase();
    return story.title.toLowerCase().includes(q) || 
           story.fandom.toLowerCase().includes(q) || 
           story.content.toLowerCase().includes(q);
  });

  if (stories.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <div className="bg-panel-main p-6 rounded-full mb-6 border border-border-main">
          <BookOpen className="w-12 h-12 text-text-muted" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Библиотека пуста</h2>
        <p className="text-text-muted mb-8 max-w-md">Вы еще не создали ни одной истории. Перейдите в раздел создания, чтобы написать свой первый шедевр.</p>
        <Link to="/create" className="bg-text-main text-bg-main px-6 py-3 rounded-xl font-medium hover:opacity-90 transition-opacity">
          Создать историю
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto py-8 space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold">Ваша библиотека</h2>
          <span className="text-text-muted">{stories.length} историй</span>
        </div>
        
        <div className="relative w-full md:w-96">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input 
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск по фэндому, героям, сюжету..."
            className="w-full bg-panel-main border border-border-main rounded-xl pl-10 pr-4 py-3 outline-none focus:border-primary-main focus:ring-1 focus:ring-primary-main transition-all"
          />
        </div>
      </div>

      {filteredStories.length === 0 ? (
        <div className="text-center py-20 text-text-muted">
          <Search className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p>По вашему запросу ничего не найдено.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredStories.map((story) => (
            <Link to={`/story/${story.id}`} key={story.id} className="bg-panel-main border border-border-main rounded-2xl p-6 hover:border-primary-main/50 transition-colors group flex flex-col h-64">
              <div className="flex items-center gap-2 text-xs font-medium text-primary-main mb-3">
                <span className="bg-primary-main/10 px-2 py-1 rounded-md">{story.fandom}</span>
              </div>
              <h3 className="text-lg font-bold mb-2 line-clamp-2 group-hover:text-primary-main transition-colors">{story.title}</h3>
              <p className="text-text-muted text-sm line-clamp-4 mb-auto">
                {story.content.replace(/[#*`]/g, '').substring(0, 150)}...
              </p>
              <div className="flex items-center gap-2 text-xs text-text-muted mt-4 pt-4 border-t border-border-main">
                <Clock className="w-3 h-3" />
                {story.date}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const ACCENT_COLORS = [
  { id: null, name: 'По умолчанию', color: 'var(--primary-color)' },
  { id: '#3b82f6', name: 'Синий', color: '#3b82f6' },
  { id: '#8b5cf6', name: 'Фиолетовый', color: '#8b5cf6' },
  { id: '#10b981', name: 'Изумрудный', color: '#10b981' },
  { id: '#f43f5e', name: 'Розовый', color: '#f43f5e' },
  { id: '#f59e0b', name: 'Янтарный', color: '#f59e0b' },
];

function SettingsPage({ theme, font, accentColor, textSize, updateTheme, updateFont, updateAccentColor, updateTextSize }: any) {
  return (
    <div className="max-w-3xl mx-auto py-8 space-y-10">
      <div>
        <h2 className="text-3xl font-bold mb-2">Настройки</h2>
        <p className="text-text-muted">Настройте внешний вид приложения под себя.</p>
      </div>

      <div className="space-y-6">
        <h3 className="text-xl font-semibold flex items-center gap-2">
          <Palette className="w-5 h-5 text-primary-main" /> Тема оформления
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => updateTheme(t.id)}
              className={cn(
                "p-4 rounded-2xl border text-left transition-all",
                theme === t.id 
                  ? "border-primary-main bg-primary-main/5 ring-1 ring-primary-main" 
                  : "border-border-main bg-panel-main hover:border-text-muted"
              )}
            >
              <div className="font-semibold mb-1">{t.name}</div>
              <div className="text-xs text-text-muted">{t.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-6">
        <h3 className="text-xl font-semibold flex items-center gap-2">
          <Type className="w-5 h-5 text-primary-main" /> Шрифт текста
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {FONTS.map((f) => (
            <button
              key={f.id}
              onClick={() => updateFont(f.id)}
              className={cn(
                "p-4 rounded-2xl border text-left transition-all",
                font === f.id 
                  ? "border-primary-main bg-primary-main/5 ring-1 ring-primary-main" 
                  : "border-border-main bg-panel-main hover:border-text-muted"
              )}
            >
              <div className={cn("text-xl mb-2", f.id)}>Aa Bb Cc</div>
              <div className="font-semibold">{f.name}</div>
              <div className="text-xs text-text-muted">{f.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-6 pt-6 border-t border-border-main">
        <h3 className="text-xl font-semibold flex items-center gap-2">
          <Sliders className="w-5 h-5 text-primary-main" /> Тонкая настройка
        </h3>
        
        <div className="space-y-8">
          <div>
            <label className="block text-sm font-medium text-text-muted mb-3">Акцентный цвет</label>
            <div className="flex flex-wrap gap-3">
              {ACCENT_COLORS.map((c) => (
                <button
                  key={c.name}
                  onClick={() => updateAccentColor(c.id)}
                  className={cn(
                    "w-10 h-10 rounded-full border-2 transition-all hover:scale-110",
                    accentColor === c.id || (!accentColor && !c.id) ? "border-text-main scale-110" : "border-transparent"
                  )}
                  style={{ backgroundColor: c.color }}
                  title={c.name}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-muted mb-3">
              Размер текста для чтения: {textSize}px
            </label>
            <input 
              type="range" 
              min="14" 
              max="24" 
              step="1"
              value={textSize}
              onChange={(e) => updateTextSize(Number(e.target.value))}
              className="w-full max-w-md accent-primary-main"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function SearchPage() {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<string>('');

  const handleSearch = async () => {
    if (!query) return;
    setIsSearching(true);
    setResults('');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `
        Пользователь ищет реально существующие фанфики по описанию: "${query}".
        
        Твоя задача:
        1. Порекомендовать 3-5 реально существующих популярных фанфиков, которые подходят под это описание (желательно с Ficbook или AO3).
        2. Сгенерировать прямые ссылки на поиск по тегам для Ficbook и AO3.
        
        Формат ответа (используй Markdown):
        ### 📚 Рекомендации
        * **[Название]** (Автор) — Краткое описание, почему это подходит.
        
        ### 🔍 Ссылки на поиск
        * [Искать на Ficbook](https://ficbook.net/find?title=&fandom_filter=any&tags=...) (Сгенерируй примерную ссылку с нужными тегами)
        * [Искать на AO3](https://archiveofourown.org/works/search?work_search[query]=...) (Сгенерируй примерную ссылку)
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: prompt,
      });

      setResults(response.text || 'Ничего не найдено.');
    } catch (error) {
      console.error(error);
      setResults('Произошла ошибка при поиске.');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 py-8">
      <div className="text-center space-y-2">
        <h2 className="text-3xl font-bold">Поиск в открытых источниках</h2>
        <p className="text-text-muted">Найдите уже написанные шедевры на Ficbook и AO3.</p>
      </div>

      <div className="bg-panel-main border border-border-main rounded-2xl p-6 md:p-8 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
            <input 
              type="text" 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Например: Гарри Поттер, Драко и Гермиона, романтика..."
              className="w-full bg-bg-main border border-border-main rounded-xl pl-12 pr-4 py-4 outline-none focus:border-primary-main focus:ring-1 focus:ring-primary-main transition-all text-lg"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={isSearching || !query}
            className="bg-primary-main hover:bg-primary-hover text-white px-8 py-4 rounded-xl font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSearching ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Найти'}
          </button>
        </div>
      </div>

      {(results || isSearching) && (
        <div className="bg-panel-main border border-border-main rounded-2xl p-8 shadow-sm min-h-[300px]">
          {isSearching ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-10">
              <Loader2 className="w-10 h-10 animate-spin text-primary-main mb-4" />
              <h3 className="text-lg font-medium">Ищем лучшие работы...</h3>
            </div>
          ) : (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="prose max-w-none dark:prose-invert"
              style={{ color: 'var(--text-color)' }}
            >
              <div className="markdown-body">
                <Markdown components={{ a: ({node, ...props}) => <a className="text-primary-main underline hover:text-primary-hover" target="_blank" rel="noopener noreferrer" {...props} /> }}>
                  {results}
                </Markdown>
              </div>
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Main App ---

import { useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

function StoryPage({ stories, textSize }: { stories: Story[], textSize: number }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const story = stories.find(s => s.id === id);

  if (!story) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold mb-4">История не найдена</h2>
        <button onClick={() => navigate('/library')} className="text-primary-main hover:underline">Вернуться в библиотеку</button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-8 space-y-8">
      <button onClick={() => navigate('/library')} className="flex items-center gap-2 text-text-muted hover:text-text-main transition-colors">
        <ArrowLeft className="w-5 h-5" /> Назад в библиотеку
      </button>
      
      <div className="bg-panel-main border border-border-main rounded-2xl p-8 shadow-sm">
        <div className="mb-8 border-b border-border-main pb-8">
          <div className="flex items-center gap-2 text-sm font-medium text-primary-main mb-4">
            <span className="bg-primary-main/10 px-3 py-1 rounded-lg">{story.fandom}</span>
            <span className="text-text-muted">{story.date}</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold">{story.title}</h1>
        </div>
        
        <div 
          className="prose max-w-none dark:prose-invert"
          style={{ color: 'var(--text-color)' }}
        >
          <div className="markdown-body leading-relaxed" style={{ fontSize: `${textSize}px` }}>
            <Markdown>{story.content}</Markdown>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

function AppContent() {
  const { theme, font, accentColor, textSize, generationsLeft, stories, updateTheme, updateFont, updateAccentColor, updateTextSize, useGeneration, saveStory, user } = useAppStore();

  return (
    <BrowserRouter>
      <div 
        className={cn("min-h-screen flex flex-col font-sans", font)}
        style={{ 
          ...(accentColor ? { '--primary-color': accentColor, '--primary-hover': accentColor } : {})
        } as React.CSSProperties}
      >
        <Navbar generationsLeft={generationsLeft} />
        
        <main className="flex-1 w-full px-4 md:px-8">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/create" element={
              <CreatePage 
                generationsLeft={generationsLeft} 
                useGeneration={useGeneration} 
                saveStory={saveStory}
                textSize={textSize}
                user={user}
              />
            } />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/library" element={<LibraryPage stories={stories} />} />
            <Route path="/story/:id" element={<StoryPage stories={stories} textSize={textSize} />} />
            <Route path="/settings" element={
              <SettingsPage 
                theme={theme} 
                font={font} 
                accentColor={accentColor}
                textSize={textSize}
                updateTheme={updateTheme} 
                updateFont={updateFont} 
                updateAccentColor={updateAccentColor}
                updateTextSize={updateTextSize}
              />
            } />
          </Routes>
        </main>

        <footer className="py-8 text-center text-text-muted border-t border-border-main mt-auto">
          <p className="font-medium tracking-widest uppercase text-xs opacity-50 hover:opacity-100 transition-opacity">
            by crollow
          </p>
        </footer>
      </div>
    </BrowserRouter>
  );
}
