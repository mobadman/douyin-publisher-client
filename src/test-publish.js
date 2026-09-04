const fs = require('node:fs');
const path = require('node:path');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);

function countChineseCharacters(value) {
  return (String(value || '').match(/[\u3400-\u9fff]/g) || []).length;
}

function normalizeTags(tags) {
  const values = Array.isArray(tags) ? tags : String(tags || '').split(/[，,\n]/);
  const normalized = values
    .map((tag) => String(tag).trim().replace(/^#+/, '').replace(/\s+/g, ''))
    .filter(Boolean);
  return [...new Set(normalized)].slice(0, 5);
}

function validateLocalFile(filePath, extensions, label) {
  if (!filePath || typeof filePath !== 'string') throw new Error(`请选择${label}`);
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`${label}不存在或不是文件`);
  }
  if (!extensions.has(path.extname(resolved).toLowerCase())) {
    throw new Error(`${label}格式不受支持`);
  }
  return resolved;
}

function validateImageSignature(filePath) {
  const header = Buffer.alloc(8);
  const descriptor = fs.openSync(filePath, 'r');
  try {
    fs.readSync(descriptor, header, 0, header.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  const extension = path.extname(filePath).toLowerCase();
  const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const isPng = header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if ((extension === '.png' && !isPng) || (extension !== '.png' && !isJpeg)) {
    throw new Error('封面图片扩展名与真实文件格式不一致');
  }
  return filePath;
}

function normalizeTestPayload(input, now = new Date()) {
  const videoPath = validateLocalFile(input.videoPath, VIDEO_EXTENSIONS, '测试视频');
  const coverPath = input.coverPath
    ? validateImageSignature(validateLocalFile(input.coverPath, IMAGE_EXTENSIONS, '封面图片'))
    : null;
  const body = String(input.body || '').trim();
  const tags = normalizeTags(input.tags);
  const scheduledAt = new Date(input.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) throw new Error('请选择有效的定时发布时间');
  if (scheduledAt.getTime() <= now.getTime()) throw new Error('定时发布时间必须晚于当前时间');

  return {
    videoPath,
    coverPath,
    body,
    tags,
    scheduledAt: scheduledAt.toISOString(),
    localDate: `${scheduledAt.getFullYear()}-${String(scheduledAt.getMonth() + 1).padStart(2, '0')}-${String(scheduledAt.getDate()).padStart(2, '0')}`,
    localTime: `${String(scheduledAt.getHours()).padStart(2, '0')}:${String(scheduledAt.getMinutes()).padStart(2, '0')}`
  };
}

module.exports = {
  countChineseCharacters,
  normalizeTags,
  normalizeTestPayload,
  VIDEO_EXTENSIONS,
  IMAGE_EXTENSIONS
};
