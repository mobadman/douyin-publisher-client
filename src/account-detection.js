const LOGGED_OUT_MARKERS = ['扫码登录', '验证码登录', '手机号登录', '登录后即可'];

function normalizeLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseAccountText(text, nicknameCandidates = []) {
  const lines = normalizeLines(text);
  const normalized = lines.join('\n');
  const idMatch = normalized.match(/抖音号\s*[:：]\s*([^\s]+)/);
  const loggedOut = LOGGED_OUT_MARKERS.some((marker) => normalized.includes(marker));
  const candidates = nicknameCandidates
    .map((value) => String(value || '').trim())
    .filter((value) => value && value.length <= 40);

  let nickname = candidates[0] || null;
  if (!nickname && idMatch) {
    const idLineIndex = lines.findIndex((line) => line.includes(idMatch[0]));
    const previous = idLineIndex > 0 ? lines[idLineIndex - 1] : '';
    if (previous && previous.length <= 40 && !previous.includes('创作者中心')) nickname = previous;
  }

  if (idMatch) {
    return {
      state: 'logged-in',
      nickname,
      douyinId: idMatch[1],
      message: nickname ? '已识别登录账号' : '已登录，已识别抖音号'
    };
  }
  if (loggedOut) {
    return {
      state: 'logged-out',
      nickname: null,
      douyinId: null,
      message: '尚未登录，请在打开的 Chrome 中扫码登录'
    };
  }
  return {
    state: 'uncertain',
    nickname,
    douyinId: null,
    message: '页面已打开，但暂时无法可靠识别账号；请确认页面已完全加载'
  };
}

module.exports = { parseAccountText, normalizeLines };
