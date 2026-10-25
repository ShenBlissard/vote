// 全流程自测：直接调用 Supabase 数据库函数，模拟真实使用路径
const URL_ = "https://hnspnixwlcaveekvidmm.supabase.co";
const KEY = "sb_publishable_NZXjaZkvIYrbVNeh6_5_Yg_zAoPPYqH";

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  FAIL  ${name}  ${detail}`);
  }
}

async function rpc(fn, params) {
  const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, data };
}

const pollId = Array.from({ length: 16 }, () => "23456789abcdefghjkmnpqrstuvwxyz"[Math.floor(Math.random() * 32)]).join("");
const token = Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
const ballot = () => Array.from({ length: 24 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
const future = new Date(Date.now() + 3600 * 1000).toISOString();

console.log("== 1. 安全：直接读表必须被拒绝 ==");
{
  const res = await fetch(`${URL_}/rest/v1/polls?select=*`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  check("polls 表不可直接读取", res.status === 401 || res.status === 403, `got ${res.status}`);
}

console.log("== 2. 创建投票 ==");
const cands = ["甲同学", "乙同学", "丙同学"];
const voters = [
  { name: "张三", passcode: "1111" },
  { name: "李四", passcode: "" },
  { name: "王五", passcode: "3333" },
];
{
  const r = await rpc("create_poll", {
    p_poll_id: pollId, p_admin_token: token,
    p_title: "自测投票", p_description: "自动化测试",
    p_min_choices: 2, p_max_choices: 2,
    p_shuffle_candidates: true, p_anonymous: true,
    p_deadline: future, p_allow_change: false,
    p_auto_publish: true, p_pub_top_n: -1,
    p_turnout_mode: "both",
    p_candidates: cands, p_voters: voters,
  });
  check("创建成功", r.status === 200 && r.data?.ok === true, JSON.stringify(r.data));
}
{
  const r = await rpc("create_poll", {
    p_poll_id: pollId, p_admin_token: token,
    p_title: "", p_description: "",
    p_min_choices: 2, p_max_choices: 2,
    p_shuffle_candidates: false, p_anonymous: true,
    p_deadline: future, p_allow_change: false,
    p_auto_publish: true, p_pub_top_n: -1,
    p_turnout_mode: "both",
    p_candidates: cands, p_voters: voters,
  });
  check("空标题被拒绝", r.data?.ok === false && r.data.error === "请填写投票主题");
}

console.log("== 3. 公共信息 ==");
let pub;
{
  const r = await rpc("get_poll_public", { p_poll_id: pollId });
  pub = r.data;
  check("公共信息存在", r.status === 200 && pub !== null);
  check("字段完整", pub?.title === "自测投票" && pub?.voterCount === 3 && pub?.candidates?.length === 3);
  check("进行中", pub?.open === true && pub?.resultsMode === "hidden");
  const miss = await rpc("get_poll_public", { p_poll_id: "nonexistent" });
  check("不存在的投票返回 null", miss.data === null);
}

console.log("== 4. 投票人状态（口令校验） ==");
{
  const wrong = await rpc("voter_status", { p_poll_id: pollId, p_name: "张三", p_passcode: "0000" });
  check("错误口令被拒", wrong.data?.exists === true && wrong.data?.passcodeOk === false && wrong.data?.needsPasscode === true);
  const right = await rpc("voter_status", { p_poll_id: pollId, p_name: "张三", p_passcode: "1111" });
  check("正确口令通过", right.data?.passcodeOk === true && right.data?.voted === false);
  const noCode = await rpc("voter_status", { p_poll_id: pollId, p_name: "李四", p_passcode: "" });
  check("无口令者无需口令", noCode.data?.needsPasscode === false && noCode.data?.passcodeOk === true);
  const ghost = await rpc("voter_status", { p_poll_id: pollId, p_name: "赵六", p_passcode: "" });
  check("名单外姓名不存在", ghost.data?.exists === false);
}

console.log("== 5. 投票 ==");
const candIds = pub.candidates.map((c) => c.id);
{
  const tooFew = await rpc("cast_vote", { p_poll_id: pollId, p_ballot_id: ballot(), p_name: "张三", p_passcode: "1111", p_candidate_ids: [candIds[0]] });
  check("少选被拒", tooFew.data?.ok === false && tooFew.data.error === "请选择2位候选人");
  const badCode = await rpc("cast_vote", { p_poll_id: pollId, p_ballot_id: ballot(), p_name: "王五", p_passcode: "0000", p_candidate_ids: [candIds[0], candIds[1]] });
  check("投票时口令校验", badCode.data?.ok === false && badCode.data.error === "口令错误，请向发起人核对");
  const ok1 = await rpc("cast_vote", { p_poll_id: pollId, p_ballot_id: ballot(), p_name: "张三", p_passcode: "1111", p_candidate_ids: [candIds[0], candIds[1]] });
  check("张三投票成功", ok1.data?.ok === true, JSON.stringify(ok1.data));
  const dup = await rpc("cast_vote", { p_poll_id: pollId, p_ballot_id: ballot(), p_name: "张三", p_passcode: "1111", p_candidate_ids: [candIds[0], candIds[2]] });
  check("重复投票被拒", dup.data?.ok === false && dup.data.error.includes("不允许修改"));
  const ok2 = await rpc("cast_vote", { p_poll_id: pollId, p_ballot_id: ballot(), p_name: "李四", p_passcode: "", p_candidate_ids: [candIds[0], candIds[2]] });
  check("李四投票成功", ok2.data?.ok === true);
}

console.log("== 6. 进行中结果隐藏 ==");
{
  const r = await rpc("get_results", { p_poll_id: pollId });
  check("进行中结果隐藏", r.data?.mode === "hidden" && r.data?.candidates?.length === 0);
}

console.log("== 7. 管理操作 ==");
{
  const bad = await rpc("get_admin_data", { p_admin_token: "badtoken" });
  check("错误管理 token 返回 null", bad.data === null);
  const adm = await rpc("get_admin_data", { p_admin_token: token });
  check("管理数据可读", adm.data?.votedCount === 2 && adm.data?.voterTotal === 3);
  check("匿名不含投票对象", adm.data?.roster?.find((r) => r.name === "张三")?.choiceNames?.length === 0);
  const pubEarly = await rpc("admin_action", { p_admin_token: token, p_action: "publish", p_params: {} });
  check("未截止不能公布", pubEarly.data?.ok === false);
  const setAnon = await rpc("admin_action", { p_admin_token: token, p_action: "updateSettings", p_params: { anonymous: false } });
  check("关闭匿名设置", setAnon.data?.ok === true);
  const adm2 = await rpc("get_admin_data", { p_admin_token: token });
  check("关闭匿名后可见投票对象", adm2.data?.roster?.find((r) => r.name === "张三")?.choiceNames?.length === 2);
  const close = await rpc("admin_action", { p_admin_token: token, p_action: "close", p_params: {} });
  check("立即截止", close.data?.ok === true);
  const closed = await rpc("get_poll_public", { p_poll_id: pollId });
  check("截止后 open=false", closed.data?.open === false && closed.data?.resultsMode === "published");
}

console.log("== 8. 截止后结果 ==");
{
  const r = await rpc("get_results", { p_poll_id: pollId });
  const counts = Object.fromEntries(r.data.candidates.map((c) => [c.name, c.count]));
  check("自动公布且票数正确", r.data?.mode === "published" && counts["甲同学"] === 2 && counts["乙同学"] === 1 && counts["丙同学"] === 1, JSON.stringify(counts));
  check("参与名单公布", r.data?.turnout?.votedNames?.length === 2 && r.data?.turnout?.notVotedNames?.includes("王五"));
}

console.log(`\n结果：${passed} 通过, ${failed} 失败`);
if (failed > 0) {
  console.log("失败项：" + failures.join(" | "));
  process.exit(1);
}
