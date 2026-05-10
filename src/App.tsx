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
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

// --- Utils ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const FALLBACK_API_KEYS = [
  'AIzaSyBzQ8sc_iioTDhvNte32G5UYyYmqC299bQ',
  'AIzaSyAO7s8ZHlbxtyFybDBCTz1b7pcsk5l99kQ',
  'AIzaSyB78Wa8No-9SNHzzkSb3wCG3ratdCLB0no',
];

/**
 * Идет по массиву ключей. Если один не срабатывает (например, исчерпан лимит 
 * или ключ заблокирован), автоматически пробует следующий.
 */
async function generateWithFallback(model: string, contents: string) {
  const keysToTry = [...FALLBACK_API_KEYS];
  // Добавляем ключ из окружения самым первым, если он есть
  try {
    // @ts-ignore
    const envKey = typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : (import.meta.env && import.meta.env.VITE_GEMINI_API_KEY);
    if (envKey && !keysToTry.includes(envKey)) {
      keysToTry.unshift(envKey);
    }
  } catch (err) {
    // Игнорируем ошибки при доступе к окружению в браузере (например на Netlify)
  }
  
  let lastError;
  for (const apiKey of keysToTry) {
    try {
      const ai = new GoogleGenAI({ 
        apiKey,
        // Явное указание baseURL, хотя SDK @google/genai сам использует этот адрес по умолчанию
        baseUrl: 'https://generativelanguage.googleapis.com' 
      });
      const response = await ai.models.generateContent({
        model,
        contents,
      });
      return response;
    } catch (error: any) {
      console.warn(`Ключ не сработал, пробуем следующий... Ошибка:`, error?.message || error);
      lastError = error;
    }
  }
  throw lastError || new Error("Все API ключи исчерпаны или нерабочие.");
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

interface LocalUser {
  username: string;
  isAdmin?: boolean;
}

// --- Global State Management (Context) ---
interface AppContextType {
  theme: string;
  font: string;
  accentColor: string | null;
  textSize: number;
  generationsLeft: number;
  stories: Story[];
  user: LocalUser | null;
  isAuthReady: boolean;
  updateTheme: (t: string) => void;
  updateFont: (f: string) => void;
  updateAccentColor: (c: string | null) => void;
  updateTextSize: (s: number) => void;
  useGeneration: () => Promise<void>;
  saveStory: (story: Omit<Story, 'id' | 'date'>) => Promise<void>;
  login: (username: string, password?: string, isRegister?: boolean) => { success: boolean; error?: string };
  logout: () => void;
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
  const [user, setUser] = useState<LocalUser | null>(null);
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

  // Auth & Storage sync
  useEffect(() => {
    // Admin setup
    const allUsers = JSON.parse(localStorage.getItem('crolff-all-users') || '[]');
    if (!allUsers.includes('crollow')) {
      allUsers.push('crollow');
      localStorage.setItem('crolff-all-users', JSON.stringify(allUsers));
      localStorage.setItem('crolff-user-crollow', JSON.stringify({
        username: 'crollow',
        password: '1234',
        isAdmin: true,
        extraGenerations: 0
      }));
    }

    const savedUser = localStorage.getItem('crolff-local-user');
    if (savedUser) {
      const u = JSON.parse(savedUser);
      setUser(u);
      
      const uData = JSON.parse(localStorage.getItem(`crolff-user-${u.username}`) || '{}');
      const extra = uData.extraGenerations || 0;
      
      const today = new Date().toDateString();
      const usageData = JSON.parse(localStorage.getItem(`crolff-usage-${u.username}`) || '{}');
      if (usageData.date !== today) {
        setGenerationsLeft(u.isAdmin ? 9999 : MAX_AUTH_GENERATIONS + extra);
        localStorage.setItem(`crolff-usage-${u.username}`, JSON.stringify({ date: today, count: 0 }));
      } else {
        setGenerationsLeft(u.isAdmin ? 9999 : Math.max(0, MAX_AUTH_GENERATIONS + extra - (usageData.count || 0)));
      }
      
      const savedStories = JSON.parse(localStorage.getItem(`crolff-stories-${u.username}`) || '[]');
      setStories(savedStories);
    } else {
      setGenerationsLeft(0);
      setStories([]);
    }
    setIsAuthReady(true);
  }, []);

  const login = (username: string, password?: string, isRegister?: boolean) => {
    const allUsers = JSON.parse(localStorage.getItem('crolff-all-users') || '[]');
    let uData = JSON.parse(localStorage.getItem(`crolff-user-${username}`) || 'null');
    
    if (isRegister) {
      if (uData) return { success: false, error: 'Пользователь уже существует' };
      if (!password) return { success: false, error: 'Пароль обязателен' };
      
      uData = { username, password, isAdmin: false, extraGenerations: 0 };
      allUsers.push(username);
      localStorage.setItem('crolff-all-users', JSON.stringify(allUsers));
      localStorage.setItem(`crolff-user-${username}`, JSON.stringify(uData));
    } else {
      if (!uData) return { success: false, error: 'Пользователь не найден' };
      if (password && uData.password !== password) return { success: false, error: 'Неверный пароль' };
    }

    const u = { username: uData.username, isAdmin: uData.isAdmin };
    setUser(u);
    localStorage.setItem('crolff-local-user', JSON.stringify(u));
    
    const today = new Date().toDateString();
    const usageData = JSON.parse(localStorage.getItem(`crolff-usage-${u.username}`) || '{}');
    const extra = uData.extraGenerations || 0;
    
    if (usageData.date !== today) {
      setGenerationsLeft(u.isAdmin ? 9999 : MAX_AUTH_GENERATIONS + extra);
      localStorage.setItem(`crolff-usage-${u.username}`, JSON.stringify({ date: today, count: 0 }));
    } else {
      setGenerationsLeft(u.isAdmin ? 9999 : Math.max(0, MAX_AUTH_GENERATIONS + extra - (usageData.count || 0)));
    }
    
    const savedStories = JSON.parse(localStorage.getItem(`crolff-stories-${u.username}`) || '[]');
    setStories(savedStories);
    return { success: true };
  };
  
  const logout = () => {
    setUser(null);
    localStorage.removeItem('crolff-local-user');
    setGenerationsLeft(0);
    setStories([]);
  };

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
      const uData = JSON.parse(localStorage.getItem(`crolff-user-${user.username}`) || '{}');
      const extra = uData.extraGenerations || 0;

      const today = new Date().toDateString();
      const usageData = JSON.parse(localStorage.getItem(`crolff-usage-${user.username}`) || '{}');
      const newCount = (usageData.date === today ? (usageData.count || 0) : 0) + 1;
      localStorage.setItem(`crolff-usage-${user.username}`, JSON.stringify({ date: today, count: newCount }));
      setGenerationsLeft(user.isAdmin ? 9999 : Math.max(0, MAX_AUTH_GENERATIONS + extra - newCount));
    }
  };

  const saveStory = async (storyData: Omit<Story, 'id' | 'date'>) => {
    if (!user) return;
    const dateStr = new Date().toLocaleDateString();
    const newStory: Story = { ...storyData, id: Date.now().toString(), date: dateStr };
    const newStories = [newStory, ...stories];
    setStories(newStories);
    localStorage.setItem(`crolff-stories-${user.username}`, JSON.stringify(newStories));
  };

  return (
    <AppContext.Provider value={{
      theme, font, accentColor, textSize, generationsLeft, stories, user, isAuthReady,
      updateTheme, updateFont, updateAccentColor, updateTextSize, useGeneration, saveStory,
      login, logout
    }}>
      {children}
    </AppContext.Provider>
  );
}

// --- Components ---

function Navbar({ generationsLeft }: { generationsLeft: number }) {
  const location = useLocation();
  const { user, login, logout } = useAppStore();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [loginError, setLoginError] = useState('');
  
  const navItems = [
    { path: '/', icon: HomeIcon, label: 'Главная' },
    { path: '/create', icon: Sparkles, label: 'Создать' },
    { path: '/search', icon: Search, label: 'Поиск' },
    { path: '/library', icon: Library, label: 'Библиотека' },
    ...(user?.isAdmin ? [{ path: '/admin', icon: Settings, label: 'Админка' }] : []),
    { path: '/settings', icon: Settings, label: 'Настройки' },
  ];

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (usernameInput.trim() && passwordInput.trim()) {
      const res = login(usernameInput.trim(), passwordInput.trim(), isRegisterMode);
      if (res.success) {
        setShowLoginModal(false);
        setUsernameInput('');
        setPasswordInput('');
      } else {
        setLoginError(res.error || 'Ошибка');
      }
    }
  };

  return (
    <>
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
                  generationsLeft > 0 || user.isAdmin
                    ? "bg-primary-main/10 text-primary-main border-primary-main/20" 
                    : "bg-red-500/10 text-red-500 border-red-500/20"
                )}>
                  {user.isAdmin ? "∞" : generationsLeft} <span className="hidden lg:inline font-normal opacity-80">генераций</span>
                </span>
              </div>
            )}
            
            {user ? (
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full border border-border-main flex items-center justify-center bg-panel-main text-primary-main font-bold capitalize">
                  {user.username.charAt(0)}
                </div>
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
                onClick={() => setShowLoginModal(true)}
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

      {/* Login Modal */}
      <AnimatePresence>
        {showLoginModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-bg-main border border-border-main rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl"
            >
              <div className="p-6">
                <h3 className="text-xl font-bold mb-2">{isRegisterMode ? 'Регистрация' : 'Авторизация'}</h3>
                <p className="text-text-muted text-sm mb-4">
                  {isRegisterMode ? 'Придумайте логин и пароль.' : 'Войдите, используя свой логин и пароль.'}
                </p>
                
                {loginError && (
                  <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-lg text-sm">
                    {loginError}
                  </div>
                )}
                
                <form onSubmit={handleLoginSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Имя пользователя</label>
                    <input 
                      type="text" 
                      value={usernameInput}
                      onChange={(e) => setUsernameInput(e.target.value)}
                      placeholder="Например, crollow"
                      className="w-full bg-panel-main border border-border-main rounded-xl px-4 py-3 outline-none focus:border-primary-main focus:ring-1 focus:ring-primary-main transition-all"
                      autoFocus
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Пароль</label>
                    <input 
                      type="password" 
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-panel-main border border-border-main rounded-xl px-4 py-3 outline-none focus:border-primary-main focus:ring-1 focus:ring-primary-main transition-all"
                      required
                    />
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <button 
                      type="button"
                      onClick={() => { setIsRegisterMode(!isRegisterMode); setLoginError(''); }}
                      className="text-sm text-primary-main hover:underline"
                    >
                      {isRegisterMode ? 'Уже есть аккаунт?' : 'Создать аккаунт'}
                    </button>
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button 
                      type="button"
                      onClick={() => setShowLoginModal(false)}
                      className="flex-1 px-4 py-3 rounded-xl border border-border-main bg-panel-main hover:bg-panel-hover font-medium transition-colors"
                    >
                      Отмена
                    </button>
                    <button 
                      type="submit"
                      disabled={!usernameInput.trim() || !passwordInput.trim()}
                      className="flex-1 px-4 py-3 rounded-xl bg-primary-main hover:bg-primary-hover text-white font-medium transition-colors disabled:opacity-50"
                    >
                      {isRegisterMode ? 'Регистрация' : 'Войти'}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
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

    if (generationsLeft <= 0 && !user?.isAdmin) {
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

      const response = await generateWithFallback('gemini-2.5-flash', prompt);

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
  const [results, setResults] = useState<any[]>([]);
  const { saveStory } = useAppStore();
  const [searchError, setSearchError] = useState('');

  const handleSearch = async () => {
    if (!query) return;
    setIsSearching(true);
    setResults([]);
    setSearchError('');

    try {
      const prompt = `
        Пользователь ищет фанфики по описанию: "${query}".
        
        Верни JSON массив из 3-5 выдуманных или реальных интересных фанфиков. 
        Не используй блок \`\`\`json. Только чистый массив!
        Поля:
        - title: строка
        - author: строка
        - fandom: строка
        - description: строка (краткое описание, около 2-3 предложений)
        - url: строка (ссылка на поиск или чтение, можно заглушку https://ficbook.net/find?...)
      `;

      const response = await generateWithFallback('gemini-2.5-flash', prompt);

      let text = response.text || '[]';
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();
      let parsed = [];
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        console.error("Failed to parse JSON:", text);
        setSearchError('Ошибка формата ответа нейросети. Попробуйте еще раз.');
      }
      setResults(parsed);
    } catch (error) {
      console.error(error);
      setSearchError('Произошла ошибка при поиске.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddToLibrary = async (res: any) => {
    await saveStory({
      title: res.title,
      fandom: res.fandom,
      content: `**Автор:** ${res.author}\n\n**Описание:** ${res.description}\n\n[Читать оригинал](${res.url})`
    });
    alert('Добавлено в библиотеку!');
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

      {(results.length > 0 || isSearching || searchError) && (
        <div className="bg-panel-main border border-border-main rounded-2xl p-6 md:p-8 shadow-sm min-h-[300px]">
          {isSearching ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-10">
              <Loader2 className="w-10 h-10 animate-spin text-primary-main mb-4" />
              <h3 className="text-lg font-medium">Ищем лучшие работы...</h3>
            </div>
          ) : searchError ? (
            <div className="text-center text-red-500 py-10">{searchError}</div>
          ) : (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-4"
            >
              {results.map((res, i) => (
                <div key={i} className="border border-border-main p-5 rounded-xl bg-bg-main hover:border-primary-main/50 transition-colors">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 text-xs font-medium text-primary-main mb-2">
                        <span className="bg-primary-main/10 px-2 py-1 rounded-md">{res.fandom}</span>
                        <span className="text-text-muted">Автор: {res.author}</span>
                      </div>
                      <h3 className="text-xl font-bold mb-2">{res.title}</h3>
                      <p className="text-text-muted text-sm max-w-2xl leading-relaxed">{res.description}</p>
                    </div>
                    <div className="flex flex-row md:flex-col gap-2 shrink-0">
                      <a 
                        href={res.url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="bg-primary-main hover:bg-primary-hover text-white px-4 py-2 text-sm rounded-lg font-medium transition-all flex items-center gap-2 justify-center"
                      >
                        Читать оригинал
                      </a>
                      <button 
                        onClick={() => handleAddToLibrary(res)}
                        className="bg-panel-hover hover:bg-border-main text-text-main border border-border-main px-4 py-2 text-sm rounded-lg font-medium transition-all flex items-center gap-2 justify-center"
                      >
                        <Library className="w-4 h-4" /> В библиотеку
                      </button>
                    </div>
                  </div>
                </div>
              ))}
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

function AdminPage() {
  const { user } = useAppStore();
  const navigate = useNavigate();
  const [users, setUsers] = useState<any[]>([]);
  const [storiesMap, setStoriesMap] = useState<Record<string, Story[]>>({});
  const [viewingUser, setViewingUser] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.isAdmin) {
      navigate('/');
      return;
    }
    loadData();
  }, [user, navigate]);

  const loadData = () => {
    const allUsers = JSON.parse(localStorage.getItem('crolff-all-users') || '[]');
    const smap: Record<string, Story[]> = {};
    const loadedUsers = allUsers.map((uStr: string) => {
      const uData = JSON.parse(localStorage.getItem(`crolff-user-${uStr}`) || '{}');
      const st = JSON.parse(localStorage.getItem(`crolff-stories-${uStr}`) || '[]');
      smap[uStr] = st;
      return { 
        username: uStr,
        isAdmin: uData.isAdmin,
        extraGenerations: uData.extraGenerations || 0,
        storyCount: st.length
      };
    });
    setUsers(loadedUsers);
    setStoriesMap(smap);
  };

  const handleToggleInfinity = (username: string, hasInfinity: boolean) => {
    const uData = JSON.parse(localStorage.getItem(`crolff-user-${username}`) || '{}');
    uData.extraGenerations = hasInfinity ? 0 : 9999;
    localStorage.setItem(`crolff-user-${username}`, JSON.stringify(uData));
    loadData();
  };

  if (!user?.isAdmin) return null;

  // Compute stats
  const totalStories = Object.values(storiesMap).reduce((acc, curr) => acc + curr.length, 0);
  const totalUsers = users.length;
  
  // Fake chart data (due to localStorage we don't have real timestamps, so we mock last 7 days somewhat)
  const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const activeUsersData = days.map((Day, i) => ({
    name: Day,
    пользователи: Math.max(1, Math.floor(totalUsers * (Math.random() * 0.5 + 0.5))),
  }));

  const fandomsRaw: Record<string, number> = {};
  Object.values(storiesMap).flat().forEach(s => {
    fandomsRaw[s.fandom || 'Ориджинал'] = (fandomsRaw[s.fandom || 'Ориджинал'] || 0) + 1;
  });
  const popularFandoms = Object.entries(fandomsRaw)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  
  const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#f43f5e'];

  return (
    <div className="max-w-6xl mx-auto py-8 space-y-8">
      <div className="space-y-2">
        <h2 className="text-3xl font-bold flex items-center gap-3">
          <Crown className="w-8 h-8 text-yellow-500" /> Панель администратора
        </h2>
        <p className="text-text-muted">Статистика сайта и управление пользователями.</p>
      </div>

      {viewingUser ? (
        <div className="bg-panel-main border border-border-main rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-2xl font-bold">Фанфики: {viewingUser}</h3>
            <button 
              onClick={() => setViewingUser(null)}
              className="px-4 py-2 text-sm border border-border-main rounded-xl hover:bg-panel-hover"
            >
              Закрыть
            </button>
          </div>
          {storiesMap[viewingUser]?.length === 0 ? (
            <p className="text-text-muted">У этого пользователя нет фанфиков.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {storiesMap[viewingUser]?.map((story) => (
                <div key={story.id} className="border border-border-main p-4 rounded-xl">
                  <div className="text-xs text-primary-main mb-1">{story.fandom}</div>
                  <h4 className="font-bold line-clamp-1">{story.title}</h4>
                  <p className="text-sm text-text-muted mt-2 line-clamp-2">{story.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Stats Segment */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="bg-panel-main border border-border-main rounded-2xl p-6 shadow-sm">
              <div className="text-text-muted text-sm font-medium mb-1">Всего пользователей</div>
              <div className="text-4xl font-bold">{totalUsers}</div>
            </div>
            <div className="bg-panel-main border border-border-main rounded-2xl p-6 shadow-sm">
              <div className="text-text-muted text-sm font-medium mb-1">Всего фанфиков</div>
              <div className="text-4xl font-bold">{totalStories}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-panel-main border border-border-main rounded-2xl p-6 shadow-sm min-h-[300px]">
              <h3 className="font-bold mb-4">Активные пользователи (симуляция недели)</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={activeUsersData}>
                  <XAxis dataKey="name" stroke="#888" tick={{ fill: 'var(--text-color)' }} />
                  <YAxis stroke="#888" tick={{ fill: 'var(--text-color)' }} />
                  <RechartsTooltip contentStyle={{ backgroundColor: 'var(--bg-main)', borderColor: 'var(--border-main)', borderRadius: '12px' }} />
                  <Bar dataKey="пользователи" fill="var(--primary-color)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            
            <div className="bg-panel-main border border-border-main rounded-2xl p-6 shadow-sm min-h-[300px]">
              <h3 className="font-bold mb-4">Популярные фэндомы</h3>
              {popularFandoms.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={popularFandoms} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                      {popularFandoms.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip contentStyle={{ backgroundColor: 'var(--bg-main)', borderColor: 'var(--border-main)', borderRadius: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-text-muted text-center py-10">Нет данных</div>
              )}
            </div>
          </div>

          {/* User Management */}
          <div className="bg-panel-main border border-border-main rounded-2xl p-6 shadow-sm">
            <h3 className="text-xl font-bold mb-4">Список пользователей</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[600px]">
                <thead>
                  <tr className="border-b border-border-main text-text-muted text-sm">
                    <th className="pb-3 pr-4 font-medium">Юзернейм</th>
                    <th className="pb-3 px-4 font-medium">Роль</th>
                    <th className="pb-3 px-4 font-medium">Фанфики</th>
                    <th className="pb-3 pl-4 font-medium">Управление генерациями</th>
                    <th className="pb-3 pl-4 font-medium text-right">Действие</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {users.map((u) => {
                    const hasInfinity = u.isAdmin || u.extraGenerations > 0;
                    return (
                      <tr key={u.username} className="border-b border-border-main/50 hover:bg-bg-main/50 transition-colors">
                        <td className="py-4 pr-4 font-semibold">{u.username}</td>
                        <td className="py-4 px-4 text-text-muted">{u.isAdmin ? 'Администратор' : 'Пользователь'}</td>
                        <td className="py-4 px-4 text-text-muted">{u.storyCount}</td>
                        <td className="py-4 px-4">
                          {!u.isAdmin && (
                            <button 
                              onClick={() => handleToggleInfinity(u.username, hasInfinity)}
                              className={cn(
                                "text-xs px-3 py-1.5 rounded-lg border font-medium transition-all",
                                hasInfinity ? "bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20" : "bg-primary-main/10 text-primary-main border-primary-main/20 hover:bg-primary-main/20"
                              )}
                            >
                              {hasInfinity ? 'Отозвать бесконечность' : 'Выдать ∞ генераций'}
                            </button>
                          )}
                        </td>
                        <td className="py-4 pl-4 text-right">
                          <button
                            onClick={() => setViewingUser(u.username)}
                            className="text-primary-main hover:underline font-medium"
                          >
                            Просмотр работ
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

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
            <Route path="/admin" element={<AdminPage />} />
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
