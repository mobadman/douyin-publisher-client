const PUBLISH_SUCCESS_PATTERN = /发布成功|提交成功|作品发布成功|已提交审核/;
const PUBLISH_ERROR_PATTERN = /发布失败|提交失败|网络异常|系统异常|请稍后重试|内容不符合|上传失败/;
function classifyPublishSnapshot({ initialUrl, currentUrl, successMessage = '', errorMessage = '' }) {
  if (errorMessage && PUBLISH_ERROR_PATTERN.test(errorMessage)) {
    return { state: 'failed', detail: errorMessage.trim() };
  }
  if (successMessage && PUBLISH_SUCCESS_PATTERN.test(successMessage)) {
    return { state: 'published', detail: successMessage.trim() };
  }
  if (currentUrl !== initialUrl) return { state: 'responded', detail: `页面已跳转但尚未确认成功：${currentUrl}` };
  return { state: 'waiting', detail: '' };
}

function createPlatformSubmissionEvidence(payload, publishResult) {
  if (publishResult?.state !== 'published' || !PUBLISH_SUCCESS_PATTERN.test(String(publishResult.detail || ''))) {
    throw new Error('平台没有返回明确的发布成功提示，不能将视频标记为已提交');
  }
  return {
    detail: `平台已明确返回“${String(publishResult.detail).trim()}”；作品ID待批次完成后同步`,
    source: 'platform-success-message',
    confirmation: String(publishResult.detail).trim(),
    scheduledLocal: `${payload.localDate} ${payload.localTime}`,
    videoUrl: '',
    videoId: ''
  };
}

module.exports = {
  classifyPublishSnapshot,
  createPlatformSubmissionEvidence,
  PUBLISH_SUCCESS_PATTERN,
  PUBLISH_ERROR_PATTERN
};
