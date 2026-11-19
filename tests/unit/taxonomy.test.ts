import { describe, it, expect } from 'vitest';
import { classify, autoTags, CATEGORIES, TAG_GROUPS, categoryName, categoryPath, ALL_TAGS } from '../../src/server/taxonomy';

describe('分类与标签体系', () => {
  it('分类 ID 唯一，父级存在', () => {
    const ids = CATEGORIES.map(c => c.id); expect(new Set(ids).size).toBe(ids.length);
    for (const c of CATEGORIES) if (c.parent) expect(ids).toContain(c.parent);
  });
  it('关键词分类', () => {
    expect(classify('AI writing assistant for copywriting')).toBe('ai-writing');
    expect(classify('Open-source CLI to deploy your API')).toBe('dev');
    expect(classify('Invoice and payment for freelancers')).toBe('finance');
    expect(classify('Fitness workout tracker')).toBe('health');
    expect(classify('一个帮助学生学习的课程平台')).toBe('education');
    expect(classify('said email detail')).toBe('other'); // 'ai' 不应误匹配
  });
  it('自动标签', () => {
    const t = autoTags('Free open-source Chrome extension for developers, uses GPT. $9/mo pro plan');
    expect(t).toEqual(expect.arrayContaining(['开源', 'Chrome 扩展', '开发者', '大语言模型', '免费增值']));
    expect(t).not.toContain('免费');
    for (const x of t) expect(ALL_TAGS).toContain(x);
    expect(Object.keys(TAG_GROUPS).length).toBeGreaterThanOrEqual(5);
  });
  it('名称与路径', () => { expect(categoryName('ai-image')).toBe('AI 图像/视频'); expect(categoryName('nope')).toBe('其他'); expect(categoryPath('ai-image')).toEqual(['ai', 'ai-image']); });
});
