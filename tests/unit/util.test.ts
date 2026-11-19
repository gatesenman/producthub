import { describe, it, expect } from 'vitest';
import { uuidv5, normalizeUrl, hostOf, productDedupKey, productGuid, sourceGuid, slugName, stripHtml, safeJson } from '../../src/server/util';

describe('util', () => {
  it('uuidv5 稳定且符合 RFC4122 v5 格式', () => {
    const a = uuidv5('hello', '6ba7b810-9dad-11d1-80b4-00c04fd430c8');
    expect(a).toBe(uuidv5('hello', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // 已知向量：python uuid.uuid5(NAMESPACE_DNS,'python.org')
    expect(uuidv5('python.org', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
  });
  it('normalizeUrl 去除 www/跟踪参数/尾斜杠/hash', () => {
    expect(normalizeUrl('HTTP://www.Example.com/path/?utm_source=x&ref=ph&id=3#top')).toBe('https://example.com/path?id=3');
    expect(normalizeUrl('example.com')).toBe('https://example.com');
    expect(normalizeUrl('')).toBeNull(); expect(normalizeUrl('http://')).toBeNull();
    expect(hostOf('https://www.a.b.com/x')).toBe('a.b.com');
  });
  it('dedupKey：同域名合并，共享托管域名按路径区分，无网址按名称', () => {
    expect(productDedupKey({ name: 'A', url: 'https://www.foo.com/?ref=1' })).toBe(productDedupKey({ name: 'B', url: 'http://foo.com/pricing'.replace('/pricing', '') }));
    expect(productDedupKey({ name: 'x', url: 'https://github.com/a/b' })).not.toBe(productDedupKey({ name: 'x', url: 'https://github.com/c/d' }));
    expect(productDedupKey({ name: 'x', url: 'https://abc.vercel.app/x' })).toBe('host:abc.vercel.app');
    expect(productDedupKey({ name: 'My App!', url: null })).toBe('name:myapp');
    expect(productGuid('host:foo.com')).toBe(productGuid('host:foo.com'));
    expect(sourceGuid('https://www.producthunt.com/')).toBe(sourceGuid('https://producthunt.com'));
    expect(sourceGuid('https://peerlist.io/launchpad')).not.toBe(sourceGuid('https://peerlist.io/'));
  });
  it('杂项', () => {
    expect(slugName(' Foo-Bar (Beta) ')).toBe('foobarbeta');
    expect(stripHtml('<p>a&amp;b <script>x</script><b>c</b></p>')).toBe('a&b c');
    expect(safeJson('{bad', 1)).toBe(1); expect(safeJson('[1]', [])).toEqual([1]);
  });
});

import { decodeEntities } from '../../src/server/util';
describe('decodeEntities', () => {
  it('解码命名与数字实体', () => { expect(decodeEntities('Do you use &#8216;AI&#8217; &amp; &#x2014; tools&hellip;')).toBe('Do you use ‘AI’ & — tools…'); expect(decodeEntities('&unknown; 1 &lt; 2')).toBe('&unknown; 1 < 2'); });
});
