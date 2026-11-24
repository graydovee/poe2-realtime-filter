/** 非响应式的请求序号与标记：让过期的读取结果不覆盖新状态。 */
export const counters = {
  /** 行情 / 预览请求。切赛季、关预览、离开编辑器时递增。 */
  request: 0,
  /** 基础过滤器样式读取。 */
  inspection: 0,
  library: 0,
  catalog: 0,
  market: 0,
  /** 本次编辑是否更换过基础过滤器，保存时带给后端。 */
  baseFilterChanged: false,
};
