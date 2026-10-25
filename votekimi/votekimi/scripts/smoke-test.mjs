const BASE = "http://localhost:3000";
let passed = 0;
let failed = 0;

function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log("PASS - " + name);
  } else {
    failed++;
    console.log("FAIL - " + name + (extra !== undefined ? " | " + JSON.stringify(extra) : ""));
  }
}

async function api(path, method = "GET", body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = {};
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

const futureIso = (min) => new Date(Date.now() + min * 60000).toISOString();
const enc = encodeURIComponent;

async function main() {
  let r = await api("/api/polls", "POST", {
    title: "无效测试",
    deadline: futureIso(30),
    candidates: ["甲", "乙", "丙"],
    voters: ["张三"],
    minChoices: 3,
    maxChoices: 2,
  });
  check("最少人数大于最多人数被拒绝", r.status === 400);
  r = await api("/api/polls", "POST", {
    title: "无效测试",
    deadline: futureIso(30),
    candidates: ["甲", "乙", "丙"],
    voters: ["张三"],
    minChoices: 1,
    maxChoices: 1,
    pubTopN: 99,
  });
  check("前N名超过候选人数被拒绝", r.status === 400);

  const votersA = [];
  for (let i = 1; i <= 8; i++) votersA.push({ name: `同学${"一二三四五六七八"[i - 1]}`, passcode: `100${i}` });
  votersA.push({ name: "同学九", passcode: "" });
  votersA.push({ name: "同学十", passcode: "" });

  r = await api("/api/polls", "POST", {
    title: "班长选举",
    description: "口令+前N名测试",
    minChoices: 1,
    maxChoices: 1,
    shuffleCandidates: true,
    anonymous: false,
    deadline: futureIso(30),
    allowChange: false,
    autoPublish: false,
    pubTopN: 2,
    turnoutMode: "voted",
    candidates: ["甲", "乙", "丙", "丁"],
    voters: votersA,
  });
  check("创建投票A", r.status === 201 && r.json.id && r.json.adminToken, r.json);
  const pollA = r.json;

  r = await api(`/api/polls/${pollA.id}`);
  check("A基础信息", r.json.minChoices === 1 && r.json.maxChoices === 1 && r.json.candidates.length === 4 && r.json.voterCount === 10 && r.json.resultsMode === "hidden", r.json);
  check("A乱序标记返回且顺序固定", r.json.shuffleCandidates === true && r.json.candidates.map((c) => c.name).join("") === "甲乙丙丁", r.json.candidates);
  const cid = Object.fromEntries(r.json.candidates.map((c) => [c.name, c.id]));

  r = await api(`/api/polls/${pollA.id}/voter-status?name=${enc("同学一")}`);
  check("A无口令查询被拒", r.json.exists === true && r.json.needsPasscode === true && r.json.passcodeOk === false, r.json);
  r = await api(`/api/polls/${pollA.id}/voter-status?name=${enc("同学一")}&passcode=9999`);
  check("A错误口令被拒", r.json.passcodeOk === false);
  r = await api(`/api/polls/${pollA.id}/voter-status?name=${enc("同学一")}&passcode=1001`);
  check("A正确口令通过", r.json.passcodeOk === true && r.json.voted === false);
  r = await api(`/api/polls/${pollA.id}/voter-status?name=${enc("同学九")}`);
  check("A无口令人员直接通过", r.json.exists === true && r.json.needsPasscode === false && r.json.passcodeOk === true, r.json);

  r = await api(`/api/polls/${pollA.id}/vote`, "POST", { name: "同学一", passcode: "9999", candidateIds: [cid["甲"]] });
  check("A错误口令投票被拒", r.status === 400);
  r = await api(`/api/polls/${pollA.id}/vote`, "POST", { name: "同学一", passcode: "1001", candidateIds: [cid["甲"]] });
  check("A正确口令投票成功", r.status === 200);
  r = await api(`/api/polls/${pollA.id}/vote`, "POST", { name: "同学一", passcode: "1001", candidateIds: [cid["乙"]] });
  check("A不允许修改", r.status === 400);
  r = await api(`/api/polls/${pollA.id}/vote`, "POST", { name: "路人", candidateIds: [cid["甲"]] });
  check("A非名单被拒", r.status === 400);
  r = await api(`/api/polls/${pollA.id}/vote`, "POST", { name: "同学二", passcode: "1002", candidateIds: [cid["甲"], cid["乙"]] });
  check("A固定1人投2人被拒", r.status === 400 && r.json.error.includes("1位"), r.json);
  r = await api(`/api/polls/${pollA.id}/vote`, "POST", { name: "同学九", candidateIds: [cid["甲"]] });
  check("A无口令人员免口令投票", r.status === 200);

  await api(`/api/polls/${pollA.id}/vote`, "POST", { name: "同学二", passcode: "1002", candidateIds: [cid["甲"]] });
  await api(`/api/polls/${pollA.id}/vote`, "POST", { name: "同学三", passcode: "1003", candidateIds: [cid["甲"]] });
  await api(`/api/polls/${pollA.id}/vote`, "POST", { name: "同学四", passcode: "1004", candidateIds: [cid["乙"]] });
  await api(`/api/polls/${pollA.id}/vote`, "POST", { name: "同学五", passcode: "1005", candidateIds: [cid["乙"]] });
  await api(`/api/polls/${pollA.id}/vote`, "POST", { name: "同学六", passcode: "1006", candidateIds: [cid["丙"]] });
  await api(`/api/polls/${pollA.id}/vote`, "POST", { name: "同学七", passcode: "1007", candidateIds: [cid["丁"]] });

  r = await api(`/api/admin/${pollA.adminToken}`);
  check("A管理统计", r.json.votedCount === 8 && r.json.voterTotal === 10, r.json.votedCount);
  check("A管理排名", r.json.candidates[0].name === "甲" && r.json.candidates[0].count === 4 && r.json.candidates[1].name === "乙" && r.json.candidates[1].count === 2, r.json.candidates);
  check("A管理口令显示", r.json.roster.find((x) => x.name === "同学一").passcode === "1001" && r.json.roster.find((x) => x.name === "同学九").passcode === "");
  check("A非匿名显示投票对象", r.json.roster.find((x) => x.name === "同学一").choiceNames.join("、") === "甲", r.json.roster.find((x) => x.name === "同学一"));

  r = await api(`/api/admin/${pollA.adminToken}`, "PATCH", { action: "publish" });
  check("A未截止不能公布", r.status === 400);
  r = await api(`/api/admin/${pollA.adminToken}`, "PATCH", { action: "close" });
  check("A立即截止", r.status === 200 && r.json.poll.open === false);
  r = await api(`/api/polls/${pollA.id}/vote`, "POST", { name: "同学八", passcode: "1008", candidateIds: [cid["甲"]] });
  check("A截止后投票被拒", r.status === 400);
  r = await api(`/api/polls/${pollA.id}/results`);
  check("A截止后待公布", r.json.mode === "not_published");
  r = await api(`/api/admin/${pollA.adminToken}`, "PATCH", { action: "publish" });
  check("A手动公布", r.json.poll.resultsMode === "published");

  r = await api(`/api/polls/${pollA.id}/results`);
  check("A只公布前2名", r.json.candidates.length === 2 && r.json.candidateTotal === 4 && r.json.candidates[0].name === "甲" && r.json.candidates[0].count === 4 && r.json.candidates[1].name === "乙", r.json.candidates);
  check("A只公布已投票者", r.json.turnout.votedCount === 8 && r.json.turnout.voterTotal === 10 && r.json.turnout.votedNames.length === 8 && r.json.turnout.notVotedNames === null, r.json.turnout);

  r = await api(`/api/admin/${pollA.adminToken}`, "PATCH", { action: "updateSettings", pubTopN: -1, turnoutMode: "not_voted" });
  check("A调整公布设置", r.status === 200);
  r = await api(`/api/polls/${pollA.id}/results`);
  check("A改为全部公布", r.json.candidates.length === 4, r.json.candidates);
  check("A改为只公布未投票者", r.json.turnout.notVotedNames.length === 2 && r.json.turnout.votedNames === null, r.json.turnout);
  r = await api(`/api/admin/${pollA.adminToken}`, "PATCH", { action: "unpublish" });
  r = await api(`/api/polls/${pollA.id}/results`);
  check("A撤回公布", r.json.mode === "not_published");

  r = await api("/api/polls", "POST", {
    title: "秋游地点投票",
    minChoices: 2,
    maxChoices: 3,
    deadline: futureIso(30),
    allowChange: true,
    autoPublish: true,
    pubTopN: -1,
    turnoutMode: "none",
    candidates: ["西湖", "灵隐寺", "西溪湿地", "千岛湖"],
    voters: ["小赵", "小钱", "小孙", "小李", "小周"],
  });
  check("创建投票B", r.status === 201, r.json);
  const pollB = r.json;
  r = await api(`/api/polls/${pollB.id}`);
  const cidB = Object.fromEntries(r.json.candidates.map((c) => [c.name, c.id]));
  check("B投票期间结果隐藏", r.json.resultsMode === "hidden");

  r = await api(`/api/polls/${pollB.id}/vote`, "POST", { name: "小赵", candidateIds: [cidB["西湖"]] });
  check("B低于最少人数被拒", r.status === 400 && r.json.error.includes("2~3"), r.json);
  r = await api(`/api/polls/${pollB.id}/vote`, "POST", { name: "小赵", candidateIds: [cidB["西湖"], cidB["灵隐寺"], cidB["西溪湿地"], cidB["千岛湖"]] });
  check("B超过最多人数被拒", r.status === 400);
  r = await api(`/api/polls/${pollB.id}/vote`, "POST", { name: "小赵", candidateIds: [cidB["西湖"], cidB["灵隐寺"]] });
  check("B范围内投票成功", r.status === 200);
  r = await api(`/api/polls/${pollB.id}/voter-status?name=${enc("小赵")}`);
  check("B查询已有选票", r.json.voted === true && r.json.choices.length === 2, r.json);
  r = await api(`/api/polls/${pollB.id}/vote`, "POST", { name: "小赵", candidateIds: [cidB["灵隐寺"], cidB["西溪湿地"]] });
  check("B允许修改", r.status === 200);
  await api(`/api/polls/${pollB.id}/vote`, "POST", { name: "小钱", candidateIds: [cidB["西湖"], cidB["灵隐寺"], cidB["西溪湿地"]] });
  await api(`/api/polls/${pollB.id}/vote`, "POST", { name: "小李", candidateIds: [cidB["西湖"], cidB["千岛湖"]] });

  r = await api(`/api/polls/${pollB.id}/results`);
  check("B投票期间无票数", r.json.mode === "hidden" && r.json.candidates.length === 0, r.json.mode);

  r = await api(`/api/admin/${pollB.adminToken}`, "PATCH", { action: "close" });
  check("B截止自动公布", r.json.poll.resultsMode === "published");

  r = await api(`/api/admin/${pollB.adminToken}`, "PATCH", { action: "updateDeadline", deadline: futureIso(5) });
  check("B推迟截止时间并重新开启", r.json.poll.open === true, r.json.poll);
  r = await api(`/api/polls/${pollB.id}/vote`, "POST", { name: "小孙", candidateIds: [cidB["西湖"], cidB["灵隐寺"]] });
  check("B重新开启后可投票", r.status === 200);
  r = await api(`/api/admin/${pollB.adminToken}`, "PATCH", { action: "updateDeadline", deadline: new Date(Date.now() - 60000).toISOString() });
  check("B进行中改过去时间被拒", r.status === 400 && r.json.error === "无法修改成过去的时间", r.json);
  r = await api(`/api/admin/${pollB.adminToken}`);
  check("B投票仍进行中", r.json.poll.open === true, r.json.poll);
  r = await api(`/api/admin/${pollB.adminToken}`, "PATCH", { action: "close" });
  check("B立即截止", r.json.poll.open === false);
  r = await api(`/api/admin/${pollB.adminToken}`, "PATCH", { action: "updateDeadline", deadline: new Date(Date.now() - 60000).toISOString() });
  check("B截止后改过去时间仍被拒", r.status === 400 && r.json.error === "无法修改成过去的时间", r.json);
  r = await api(`/api/polls/${pollB.id}/vote`, "POST", { name: "小周", candidateIds: [cidB["西湖"], cidB["灵隐寺"]] });
  check("B截止后投票被拒", r.status === 400);
  r = await api(`/api/polls/${pollB.id}/results`);
  check("B最终票数", r.json.candidates[0].count === 3, r.json.candidates);
  check("B参与none模式仍有数字无名单", r.json.turnout.votedCount !== null && r.json.turnout.votedNames === null && r.json.turnout.notVotedNames === null, r.json.turnout);

  r = await api("/api/polls", "POST", {
    title: "固定2人投票",
    minChoices: 2,
    maxChoices: 2,
    deadline: futureIso(30),
    autoPublish: true,
    pubTopN: 0,
    candidates: ["东", "南", "西"],
    voters: ["赵大 111", "钱二", "孙三 333"],
  });
  check("创建投票C（前0名+空格口令）", r.status === 201, r.json);
  const pollC = r.json;
  r = await api(`/api/polls/${pollC.id}`);
  const cidC = Object.fromEntries(r.json.candidates.map((c) => [c.name, c.id]));
  check("C基础信息", r.json.minChoices === 2 && r.json.maxChoices === 2 && r.json.voterCount === 3, r.json);

  r = await api(`/api/polls/${pollC.id}/voter-status?name=${enc("赵大")}`);
  check("C空格分隔口令被识别", r.json.exists === true && r.json.needsPasscode === true, r.json);
  r = await api(`/api/polls/${pollC.id}/voter-status?name=${enc("钱二")}`);
  check("C无口令人员正常", r.json.needsPasscode === false, r.json);
  r = await api(`/api/polls/${pollC.id}/vote`, "POST", { name: "赵大", passcode: "999", candidateIds: [cidC["东"], cidC["南"]] });
  check("C错误口令被拒", r.status === 400 && r.json.error.includes("口令"), r.json);
  r = await api(`/api/polls/${pollC.id}/vote`, "POST", { name: "赵大", passcode: "111", candidateIds: [cidC["东"]] });
  check("C固定2人只投1人被拒", r.status === 400 && r.json.error.includes("请选择2位"), r.json);
  r = await api(`/api/polls/${pollC.id}/vote`, "POST", { name: "赵大", passcode: "111", candidateIds: [cidC["东"], cidC["南"], cidC["西"]] });
  check("C固定2人投3人被拒", r.status === 400);
  r = await api(`/api/polls/${pollC.id}/vote`, "POST", { name: "赵大", passcode: "111", candidateIds: [cidC["东"], cidC["南"]] });
  check("C固定2人投票成功", r.status === 200);
  r = await api(`/api/polls/${pollC.id}/vote`, "POST", { name: "钱二", candidateIds: [cidC["东"], cidC["西"]] });
  check("C无口令人员投票成功", r.status === 200);
  await api(`/api/polls/${pollC.id}/vote`, "POST", { name: "孙三", passcode: "333", candidateIds: [cidC["南"], cidC["西"]] });

  r = await api(`/api/admin/${pollC.adminToken}`, "PATCH", { action: "close" });
  check("C截止自动公布", r.json.poll.resultsMode === "published");
  r = await api(`/api/polls/${pollC.id}/results`);
  check("C前0名不公布任何票数", r.json.candidates.length === 0 && r.json.turnout.votedCount === 3, r.json.candidates);
  r = await api(`/api/admin/${pollC.adminToken}`, "PATCH", { action: "updateSettings", pubTopN: 1 });
  check("C设置前1名", r.status === 200);
  r = await api(`/api/polls/${pollC.id}/results`);
  check("C并列时含并列公布（3人并列全公布）", r.json.candidates.length === 3 && r.json.candidateTotal === 3 && r.json.candidates.every((c) => c.count === 2), r.json.candidates);

  r = await api("/api/polls", "POST", {
    title: "智能解析与自动收缩",
    minChoices: 1,
    maxChoices: 1,
    deadline: futureIso(30),
    autoPublish: true,
    pubTopN: 2,
    candidates: ["东,南、西 北"],
    voters: ["甲一0421", "啊啊啊 1234 哇哇哇 8790", "丙丙", "丁四", "戊五", "己六"],
  });
  check("创建投票D（混合分隔符+连写口令+同行多组）", r.status === 201, r.json);
  const pollD = r.json;
  r = await api(`/api/polls/${pollD.id}`);
  check("D一行多名解析为4个候选人", r.json.candidates.length === 4 && r.json.voterCount === 7, { cands: r.json.candidates, voters: r.json.voterCount });
  const cidD = Object.fromEntries(r.json.candidates.map((c) => [c.name, c.id]));
  r = await api(`/api/admin/${pollD.adminToken}`);
  const rd = Object.fromEntries(r.json.roster.map((x) => [x.name, x.passcode]));
  check("D口令智能配对", rd["甲一"] === "0421" && rd["啊啊啊"] === "1234" && rd["哇哇哇"] === "8790" && rd["丙丙"] === "", rd);
  r = await api(`/api/polls/${pollD.id}/voter-status?name=${enc("甲一")}`);
  check("D连写口令需验证", r.json.needsPasscode === true, r.json);
  r = await api(`/api/polls/${pollD.id}/voter-status?name=${enc("哇哇哇")}&passcode=8790`);
  check("D同行第二组口令正确", r.json.passcodeOk === true, r.json);

  await api(`/api/polls/${pollD.id}/vote`, "POST", { name: "甲一", passcode: "0421", candidateIds: [cidD["东"]] });
  await api(`/api/polls/${pollD.id}/vote`, "POST", { name: "啊啊啊", passcode: "1234", candidateIds: [cidD["东"]] });
  await api(`/api/polls/${pollD.id}/vote`, "POST", { name: "哇哇哇", passcode: "8790", candidateIds: [cidD["南"]] });
  await api(`/api/polls/${pollD.id}/vote`, "POST", { name: "丙丙", candidateIds: [cidD["南"]] });
  await api(`/api/polls/${pollD.id}/vote`, "POST", { name: "丁四", candidateIds: [cidD["西"]] });
  await api(`/api/polls/${pollD.id}/vote`, "POST", { name: "戊五", candidateIds: [cidD["西"]] });

  r = await api(`/api/admin/${pollD.adminToken}`);
  check("D三人并列后名次自动收缩（前2名→前1名）", r.json.poll.pubTopN === 1, r.json.poll.pubTopN);
  check("D收缩后仅剩有效名次", r.json.poll.pubTopN === 1);

  await api(`/api/polls/${pollD.id}/vote`, "POST", { name: "己六", candidateIds: [cidD["北"]] });
  r = await api(`/api/admin/${pollD.adminToken}`, "PATCH", { action: "close" });
  check("D截止自动公布", r.json.poll.resultsMode === "published");
  r = await api(`/api/polls/${pollD.id}/results`);
  check("D前1名含并列公布3人", r.json.candidates.length === 3 && r.json.candidateTotal === 4 && r.json.candidates.every((c) => c.count === 2), r.json.candidates);

  r = await api("/api/polls", "POST", {
    title: "符号分隔与匿名测试",
    minChoices: 1,
    maxChoices: 1,
    deadline: futureIso(30),
    autoPublish: true,
    candidates: ["张三<李四，王五*赵六"],
    voters: ["长二<李四*<", "张三0421，王五5678，赵六"],
  });
  check("创建投票E（任意符号分隔解析）", r.status === 201, r.json);
  const pollE = r.json;
  r = await api(`/api/polls/${pollE.id}`);
  check("E符号当分隔符解析出4候选人", r.json.candidates.length === 4, r.json.candidates);
  check("E紧凑格式解析出5参与人", r.json.voterCount === 5, r.json.voterCount);
  const cidE = Object.fromEntries(r.json.candidates.map((c) => [c.name, c.id]));
  r = await api(`/api/admin/${pollE.adminToken}`);
  const re = Object.fromEntries(r.json.roster.map((x) => [x.name, x.passcode]));
  check("E紧凑口令配对", re["张三"] === "0421" && re["王五"] === "5678" && re["赵六"] === "" && re["长二"] === "" && re["李四"] === "", re);
  check("E匿名默认开启", r.json.poll.anonymous === true, r.json.poll.anonymous);
  await api(`/api/polls/${pollE.id}/vote`, "POST", { name: "长二", candidateIds: [cidE["张三"]] });
  r = await api(`/api/admin/${pollE.adminToken}`);
  check("E匿名时管理页不显示投票对象", r.json.roster.find((x) => x.name === "长二").choiceNames.length === 0, r.json.roster.find((x) => x.name === "长二"));
  r = await api(`/api/admin/${pollE.adminToken}`, "PATCH", { action: "updateSettings", anonymous: false });
  check("E关闭匿名后显示投票对象", r.json.poll.anonymous === false && r.json.roster.find((x) => x.name === "长二").choiceNames.join("、") === "张三", r.json.roster.find((x) => x.name === "长二"));

  r = await api("/api/polls/nonexistent");
  check("未知投票404", r.status === 404);
  r = await api("/api/admin/badtoken");
  check("无效管理链接404", r.status === 404);

  const homeRes = await fetch(BASE + "/");
  check("首页可访问", homeRes.status === 200);
  const vendorRes = await fetch(BASE + "/vendor/xlsx.full.min.js");
  check("导入组件xlsx可访问", vendorRes.status === 200);
  const ocrRes = await fetch(BASE + "/ocr/chi_sim.traineddata");
  check("OCR数据可访问", ocrRes.status === 200);
  const ocrGzRes = await fetch(BASE + "/ocr/chi_sim.traineddata.gz");
  check("OCR压缩数据可访问", ocrGzRes.status === 200);
  const votePageRes = await fetch(BASE + `/vote/${pollA.id}`);
  check("投票页可访问", votePageRes.status === 200);
  const adminPageRes = await fetch(BASE + `/admin/${pollA.adminToken}`);
  check("管理页可访问", adminPageRes.status === 200);

  console.log(`\n测试结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("测试脚本异常:", e);
  process.exit(1);
});
