const PUBLISH_SUCCESS_PATTERN = /发布成功|提交成功|作品发布成功|已提交审核/;
const PUBLISH_ERROR_PATTERN = /发布失败|提交失败|网络异常|系统异常|请稍后重试|内容不符合|上传失败/;
const PUBLISH_SUCCESS_URL_PATTERN = /\/creator-micro\/(content\/manage|manage|content\/post)/;

function classifyPublishSnapshot({ initialUrl, currentUrl, successMessage = '', errorMessage = '' }) {
  if (errorMessage && PUBLISH_ERROR_PATTERN.test(errorMessage)) {
    return { state: 'failed', detail: errorMessage.trim() };
  }
  if (successMessage && PUBLISH_SUCCESS_PATTERN.test(successMessage)) {
    return { state: 'published', detail: successMessage.trim() };
  }
  if (currentUrl !== initialUrl && PUBLISH_SUCCESS_URL_PATTERN.test(currentUrl)) {
    return { state: 'published', detail: `页面已跳转：${currentUrl}` };
  }
  return { state: 'waiting', detail: '' };
}

module.exports = {
  classifyPublishSnapshot,
  PUBLISH_SUCCESS_PATTERN,
  PUBLISH_ERROR_PATTERN
};
