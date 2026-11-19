/** 标准分类 + 标签体系 */
export interface Category { id: string; name: string; parent: string | null; keywords: string[] }

export const CATEGORIES: Category[] = [
  { id: 'ai', name: 'AI 人工智能', parent: null, keywords: ['ai', 'gpt', 'llm', 'chatbot', 'machine learning', 'artificial intelligence', 'openai', 'claude', 'agent', 'genai', '人工智能', '大模型', '智能体', 'copilot', 'prompt', 'diffusion', 'neural'] },
  { id: 'ai-writing', name: 'AI 写作', parent: 'ai', keywords: ['ai writer', 'copywriting', 'ai writing', '写作', 'content generation', 'blog post generator'] },
  { id: 'ai-image', name: 'AI 图像/视频', parent: 'ai', keywords: ['image generat', 'ai art', 'text-to-image', 'ai video', 'avatar', 'headshot', '图像生成', '视频生成', 'text to video'] },
  { id: 'ai-agent', name: 'AI 智能体', parent: 'ai', keywords: ['ai agent', 'autonomous agent', 'agents', 'mcp', '智能体', 'workflow automation with ai'] },
  { id: 'dev', name: '开发者工具', parent: null, keywords: ['developer', 'api', 'sdk', 'code', 'coding', 'github', 'open source', 'devops', 'database', 'cli', 'framework', 'library', 'deploy', 'backend', 'frontend', 'testing', 'debug', '开发', '开源', '编程', 'ide', 'terminal', 'self-hosted'] },
  { id: 'nocode', name: '无代码/低代码', parent: 'dev', keywords: ['no-code', 'nocode', 'low-code', 'lowcode', 'website builder', '无代码', '低代码', 'drag and drop'] },
  { id: 'productivity', name: '效率工具', parent: null, keywords: ['productivity', 'notes', 'todo', 'task', 'calendar', 'workflow', 'automation', 'note-taking', 'focus', 'time tracking', '效率', '笔记', '任务', '日程', 'browser extension', 'chrome extension'] },
  { id: 'design', name: '设计创意', parent: null, keywords: ['design', 'figma', 'ui kit', 'icons', 'font', 'illustration', 'mockup', 'logo', '设计', 'creative', 'photo editor', 'color'] },
  { id: 'marketing', name: '营销增长', parent: null, keywords: ['marketing', 'seo', 'growth', 'email marketing', 'social media', 'ads', 'newsletter', 'analytics', 'lead', 'crm', 'outreach', '营销', '增长', 'launch', 'backlink', 'directory'] },
  { id: 'sales', name: '销售客服', parent: null, keywords: ['sales', 'customer support', 'helpdesk', 'live chat', 'customer service', '客服', '销售'] },
  { id: 'finance', name: '金融财务', parent: null, keywords: ['finance', 'fintech', 'invoice', 'accounting', 'payment', 'crypto', 'bitcoin', 'web3', 'blockchain', 'budget', 'tax', 'trading', '金融', '财务', '支付'] },
  { id: 'education', name: '教育学习', parent: null, keywords: ['education', 'learning', 'course', 'student', 'teacher', 'language learning', 'tutor', 'study', '教育', '学习', '课程'] },
  { id: 'health', name: '健康医疗', parent: null, keywords: ['health', 'fitness', 'medical', 'mental health', 'meditation', 'sleep', 'workout', 'nutrition', '健康', '医疗', '健身'] },
  { id: 'ecommerce', name: '电商零售', parent: null, keywords: ['ecommerce', 'e-commerce', 'shopify', 'store', 'shopping', 'retail', 'dropshipping', '电商', '购物'] },
  { id: 'social', name: '社交社区', parent: null, keywords: ['social', 'community', 'chat', 'messaging', 'dating', 'forum', '社交', '社区'] },
  { id: 'media', name: '内容媒体', parent: null, keywords: ['video', 'podcast', 'music', 'audio', 'streaming', 'youtube', 'newsletter', 'reading', 'news', '视频', '音乐', '播客'] },
  { id: 'data', name: '数据分析', parent: null, keywords: ['data', 'analytics', 'dashboard', 'bi ', 'spreadsheet', 'visualization', 'scraping', 'scraper', '数据'] },
  { id: 'security', name: '安全隐私', parent: null, keywords: ['security', 'privacy', 'vpn', 'password', 'encryption', 'auth', '安全', '隐私'] },
  { id: 'hr', name: '招聘人力', parent: null, keywords: ['hiring', 'recruit', 'job', 'resume', 'hr ', 'talent', 'remote work', '招聘', '简历'] },
  { id: 'hardware', name: '硬件/IoT', parent: null, keywords: ['hardware', 'iot', 'device', 'gadget', 'robot', 'wearable', '硬件'] },
  { id: 'game', name: '游戏娱乐', parent: null, keywords: ['game', 'gaming', 'play', 'puzzle', 'esports', '游戏'] },
  { id: 'travel', name: '旅行出行', parent: null, keywords: ['travel', 'trip', 'flight', 'hotel', 'map', '旅行'] },
  { id: 'other', name: '其他', parent: null, keywords: [] },
];

export const TAG_GROUPS: Record<string, string[]> = {
  '商业模式': ['免费', '免费增值', '付费', '订阅制', '一次性买断', '开源'],
  '平台': ['Web', 'iOS', 'Android', 'macOS', 'Windows', 'Linux', 'Chrome 扩展', 'API', 'Slack', 'Figma 插件'],
  '目标用户': ['开发者', '设计师', '营销人员', '创业者', '学生', '企业', '个人用户', '创作者'],
  '阶段': ['预发布', '新发布', 'Beta', '成熟产品', '重大更新'],
  '技术': ['大语言模型', '计算机视觉', '语音', 'RAG', '浏览器自动化', '区块链', '自托管'],
};
const TAG_RULES: [string, RegExp][] = [
  ['免费', /\bfree\b|免费/i], ['免费增值', /freemium|free plan|free tier|免费增值/i], ['订阅制', /subscription|\/mo\b|per month|monthly|订阅/i],
  ['一次性买断', /lifetime|one-time|买断/i], ['开源', /open[- ]source|github\.com|开源/i], ['付费', /\$\d|paid|pricing|付费/i],
  ['iOS', /\bios\b|iphone|ipad|app store/i], ['Android', /android|google play/i], ['macOS', /\bmac\b|macos/i], ['Windows', /windows/i], ['Linux', /linux/i],
  ['Chrome 扩展', /chrome extension|browser extension|chrome web store|扩展/i], ['API', /\bapi\b/i], ['Slack', /slack/i], ['Figma 插件', /figma plugin/i], ['Web', /web app|website|online|saas|browser/i],
  ['开发者', /developer|engineer|devs?\b|开发者/i], ['设计师', /designer|设计师/i], ['营销人员', /marketer|marketing team/i], ['创业者', /founder|startup|indie hacker|创业/i],
  ['学生', /student|学生/i], ['企业', /enterprise|teams?\b|business|企业/i], ['创作者', /creator|youtuber|influencer|创作者/i],
  ['预发布', /waitlist|coming soon|early access|预发布/i], ['Beta', /\bbeta\b/i], ['重大更新', /\b(v\d+(\.\d+)?|2\.0|3\.0)\b|major update|new version/i],
  ['大语言模型', /\bllm|gpt|claude|gemini|language model|大模型/i], ['计算机视觉', /vision|image recognition|ocr/i], ['语音', /\bvoice|speech|\baudio|\btts\b|语音/i],
  ['RAG', /\brag\b|retrieval/i], ['浏览器自动化', /browser automation|scrap|puppeteer|playwright/i], ['区块链', /crypto|web3|blockchain|nft/i], ['自托管', /self-host/i],
];
export const ALL_TAGS = Object.values(TAG_GROUPS).flat();

const reCache = new Map<string, RegExp>();
function hit(t: string, k: string) { if (/^[a-z0-9 .\-]{1,4}$/.test(k.trim())) { let r = reCache.get(k); if (!r) { r = new RegExp('\\b' + k.trim().replace(/[.\-]/g, '\\$&') + '\\b'); reCache.set(k, r); } return r.test(t); } return t.includes(k); }
export function classify(text: string): string {
  const t = ' ' + (text || '').toLowerCase() + ' ';
  let best = 'other', bestScore = 0;
  for (const c of CATEGORIES) {
    let s = 0; for (const k of c.keywords) if (hit(t, k)) s += k.length > 4 ? 2 : 1;
    if (c.parent) s *= 1.2; // 更具体的子类优先
    if (s > bestScore) { bestScore = s; best = c.id; }
  }
  return best;
}
export function autoTags(text: string): string[] {
  const out = new Set<string>(); for (const [tag, re] of TAG_RULES) if (re.test(text || '')) out.add(tag);
  if (out.has('免费') && out.has('付费')) { out.delete('免费'); out.add('免费增值'); }
  return [...out];
}
export function categoryName(id: string | null | undefined): string { return CATEGORIES.find(c => c.id === id)?.name || '其他'; }
export function categoryPath(id: string): string[] { const c = CATEGORIES.find(x => x.id === id); if (!c) return [id]; return c.parent ? [c.parent, c.id] : [c.id]; }
