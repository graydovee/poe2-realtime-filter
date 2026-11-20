import Link from "next/link";

export default function SyncHelpPage({ params }: { params: { id: string } }) {
  return <main className="sync-help shell"><section className="panel"><p className="eyebrow">POE2-FILTER SYNC</p><h1>这是一个客户端同步链接</h1><p>请复制浏览器地址栏中的完整链接，粘贴到 Windows 客户端的“方案订阅链接”输入框。链接密钥只保存在链接片段中，不会发送给网站。</p><ol><li>下载并打开 Windows 客户端。</li><li>选择 PoE2 过滤器目录。</li><li>粘贴完整链接并点击“添加方案”。</li><li>客户端会定时检查并更新过滤器。</li></ol><Link href="/">返回过滤器编辑器</Link></section></main>;
}
