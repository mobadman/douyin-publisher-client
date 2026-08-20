const fs = require('node:fs');
const path = require('node:path');
const { normalizeTags, countChineseCharacters } = require('./test-publish');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);

function safeName(value, fallback) {
  const normalized = String(value || '').trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '');
  if (!normalized) return fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(normalized)) return `_${normalized}`;
  return normalized.slice(0, 100);
}

function readVariants(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//'));
}

class LibraryStore {
  constructor(dataRoot) {
    this.root = path.join(dataRoot, '本地素材库');
    this.coversRoot = path.join(this.root, '封面库');
    this.copyRoot = path.join(this.root, '文案库');
    this.tagsRoot = path.join(this.root, 'Tag库');
    this.cacheRoot = path.join(this.root, '下载缓存');
    this.logsRoot = path.join(this.root, '发布日志');
  }

  initialize() {
    for (const directory of Object.values(this.paths())) fs.mkdirSync(directory, { recursive: true });
    this.writeInstructions();
    return this.paths();
  }

  paths() {
    return {
      root: this.root,
      covers: this.coversRoot,
      copy: this.copyRoot,
      tags: this.tagsRoot,
      cache: this.cacheRoot,
      logs: this.logsRoot
    };
  }

  writeInstructions() {
    const instructions = [
      [
        this.coversRoot,
        '直接按“产品型号”创建文件夹，把 jpg、jpeg、png 封面放入型号文件夹。产品类目不参与路径匹配。',
        '按“产品类目/产品型号”创建文件夹，把 jpg、jpeg、png 封面放入型号文件夹。'
      ],
      [
        this.copyRoot,
        '每个产品型号直接建立一个同名 txt；每行一条正文，正文最多20个汉字。产品类目不参与路径匹配。',
        '按“产品类目”创建文件夹，每个产品型号建立一个同名 txt；每行一条正文，正文最多20个汉字。'
      ],
      [
        this.tagsRoot,
        '每个产品型号直接建立一个同名 txt；每行一组 Tag，用逗号分隔，最多5个，不必写井号。产品类目不参与路径匹配。',
        '按“产品类目”创建文件夹，每个产品型号建立一个同名 txt；每行一组 Tag，用逗号分隔，最多5个，不必写井号。'
      ]
    ];
    for (const [directory, content, previousContent] of instructions) {
      const filePath = path.join(directory, '_使用说明.txt');
      const next = `${content}\n以 // 开头的行会被忽略。\n`;
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, next, 'utf8');
      } else {
        const previous = `${previousContent}\n以 // 开头的行会被忽略。\n`;
        if (fs.readFileSync(filePath, 'utf8') === previous) fs.writeFileSync(filePath, next, 'utf8');
      }
    }
  }

  productPaths(category, model) {
    const modelName = safeName(model, '未命名产品');
    return {
      coverDirectory: path.join(this.coversRoot, modelName),
      copyFile: path.join(this.copyRoot, `${modelName}.txt`),
      tagsFile: path.join(this.tagsRoot, `${modelName}.txt`)
    };
  }

  match(item, sequence = 0) {
    const productPaths = this.productPaths(item.category, item.model);
    const copies = readVariants(productPaths.copyFile);
    const tagGroups = readVariants(productPaths.tagsFile);
    const covers = fs.existsSync(productPaths.coverDirectory)
      ? fs.readdirSync(productPaths.coverDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
        .map((entry) => path.join(productPaths.coverDirectory, entry.name))
        .sort((left, right) => left.localeCompare(right, 'zh-CN'))
      : [];
    const missing = [];
    if (!copies.length) missing.push('文案');
    if (!tagGroups.length) missing.push('Tag');
    if (!covers.length) missing.push('封面');
    const body = copies.length ? copies[sequence % copies.length] : '';
    if (body && countChineseCharacters(body) > 20) missing.push('文案超过20个汉字');
    const tags = tagGroups.length ? normalizeTags(tagGroups[sequence % tagGroups.length]) : [];
    if (tagGroups.length && !tags.length) missing.push('Tag内容为空');
    return {
      body,
      tags,
      coverPath: covers.length ? covers[sequence % covers.length] : null,
      missing: [...new Set(missing)],
      expectedPaths: productPaths
    };
  }

  clearCache() {
    const cacheRoot = path.resolve(this.cacheRoot);
    const expectedParent = path.resolve(this.root);
    if (path.dirname(cacheRoot) !== expectedParent || path.basename(cacheRoot) !== '下载缓存') {
      throw new Error('缓存目录校验失败，未执行清理');
    }
    fs.mkdirSync(cacheRoot, { recursive: true });
    const entries = fs.readdirSync(cacheRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error(`缓存中存在链接文件，已停止清理：${entry.name}`);
    }
    for (const entry of entries) fs.rmSync(path.join(cacheRoot, entry.name), { recursive: true, force: false });
    return { removed: entries.length, cacheRoot };
  }
}

module.exports = { LibraryStore, safeName, readVariants };
