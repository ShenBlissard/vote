import Link from "next/link";
import RecentPolls from "./RecentPolls";
import DraftPoll from "./DraftPoll";

export default function Home() {
  return (
    <div>
      <header className="hero">
        <div className="hero-inner">
          <h1>班级投票</h1>
          <p>发起投票 · 分享微信群 · 一人一票 · 自主公布结果</p>
          <Link href="/create" className="btn-hero">
            发起投票
          </Link>
        </div>
      </header>
      <main className="container">
        <div className="card">
          <h2 className="section-title">如何使用</h2>
          <ol className="steps-list">
            <li>
              <b>发起投票</b>：填写主题、候选人名单和班级参与名单
            </li>
            <li>
              <b>分享到群</b>：把投票链接发到微信群，大家点开即可投票
            </li>
            <li>
              <b>公布结果</b>：到达截止时间后，哪些内容公布、何时公布由你决定
            </li>
          </ol>
        </div>
        <DraftPoll />
        <RecentPolls />
        <p className="foot-note">提示：请保存好每次投票的管理链接，它是管理投票的唯一凭证</p>
      </main>
    </div>
  );
}
