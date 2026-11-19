/** 设计令牌清单（与 styles.css / tailwind.config.cjs 保持一致，由单元测试校验） */
export const COLOR_TOKENS = ['background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground', 'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted', 'muted-foreground', 'accent', 'accent-foreground', 'destructive', 'destructive-foreground', 'border', 'input', 'ring', 'brand', 'brand-foreground', 'brand-soft', 'sidebar', 'sidebar-foreground', 'sidebar-accent', 'sidebar-accent-foreground', 'sidebar-border', 'success', 'warning'] as const;
export const TYPE_SCALE = [['2xs', 11, '徽标计数、快捷键、状态栏'], ['xs', 11.5, '说明文字、次要信息、表单标签'], ['sm', 13, '正文 / 表格 / 按钮（基准）'], ['md', 14, '强调正文（详情简介）'], ['lg', 15, '页面标题、卡片大标题'], ['xl', 18, '弹窗大标题'], ['2xl', 22, 'KPI 数字']] as const;
export const SPACING = [[1, 4], [1.5, 6], [2, 8], [3, 12], [4, 16], [5, 20], [6, 24]] as const;
export const RADIUS = [['sm', 4, '徽标、小按钮'], ['md', 6, '按钮、输入框、菜单项'], ['lg', 8, '卡片、弹窗、面板'], ['full', 9999, '状态点、进度条']] as const;
export const SHADOW = [['shadow-sm', '按钮、输入框'], ['shadow-md', '下拉菜单、Tooltip'], ['shadow-lg', '弹窗、Sheet']] as const;
export const MOTION = [['duration-150', '悬停、颜色变化（fast）'], ['duration-200', '面板滑入、弹窗淡入（base）']] as const;
export const ALLOWED_DURATIONS = [150, 200];
