function chineseErrorMessage(error, context = '操作') {
  const original = String(error?.message || error || '未知错误').trim();
  if (/^[\u3400-\u9fff]/.test(original) && !/locator\.|Timeout \d+ms|Call log:|net::ERR_/i.test(original)) return original;
  let explanation = `${context}失败`;
  if (/Timeout \d+ms exceeded|timed out|timeout/i.test(original)) explanation = `${context}等待超时`;
  else if (/locator\.click|intercepts pointer events/i.test(original)) explanation = `${context}无法点击目标控件，可能有弹窗或遮罩挡住页面`;
  else if (/net::ERR_|fetch failed|ECONN|ENOTFOUND|socket/i.test(original)) explanation = `${context}发生网络连接错误`;
  else if (/Target page.*closed|browser.*closed/i.test(original)) explanation = `${context}期间浏览器或页面被关闭`;
  return `${explanation}。技术信息：${original.replace(/\s+/g, ' ').slice(0, 500)}`;
}

function asChineseError(error, context) {
  const translated = new Error(chineseErrorMessage(error, context));
  translated.code = error?.code;
  translated.cause = error;
  return translated;
}

module.exports = { chineseErrorMessage, asChineseError };
