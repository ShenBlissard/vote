# 班级投票系统

> 📋 **完整的项目背景、设计决策、迭代历史与维护指引见 [交接文档.md](./交接文档.md)**（新维护者请先读它）

面向班级场景的 H5 投票工具：发起人在网页上创建投票，把链接分享到微信群，群成员点开链接选择自己姓名（可加口令防冒投）即可投票。截止后按发起人设置的策略公布结果。

## 运行

- 日常：双击 `启动投票系统.bat`（就绪后自动打开浏览器，崩溃自动重启）
- 后台：`后台静默运行.bat`（无窗口）；停止：`停止投票系统.bat`
- 修改代码后：先运行 `重新构建.bat`
- 详细说明见 `使用说明.txt`

## 功能要点

- 投票人数范围：最少 X ~ 最多 Y 人（X=Y 为固定人数，1~1 即单选）
- 名单导入：Excel / Word / 图片离线OCR / 文本，导入后可检查修改
- 候选人乱序展示、每人独立口令（防冒投/冒改）
- 公布策略：公布票数前 N 名（或全部/不公布）、参与情况四选一、自动/手动公布
- 截止时间可随时修改（提前/推迟/推迟到未来=重新开启）
- 管理页：参与名单、排名结果（含"百分之几参与者投了TA"）、Excel/微信文字双导出

## 技术栈

- Next.js 16（App Router，Turbopack）
- Node.js 24 内置 `node:sqlite`（数据文件 `data/vote.db`，零外部服务）
- 离线 OCR：tesseract.js + chi_sim（资源在 `public/vendor`、`public/ocr`）

## 结构

```
src/
  app/
    page.tsx                  首页（含"我发起过的投票"）
    create/                   创建投票向导（4步）
    vote/[id]/                投票页（口令→投票→结果）
    admin/[token]/            管理页（名单/结果/公布设置/截止时间/导出）
    api/
      polls/                  POST 创建；[id] 信息；[id]/vote 投票；
                              [id]/voter-status 状态；[id]/results 公共结果
      admin/[token]/          GET 管理数据；PATCH close/publish/unpublish/
                              updateSettings/updateDeadline
  components/
    NameImport.tsx            名单导入（Excel/Word/图片OCR/文本）
    Copy.tsx                  复制按钮/链接框
  lib/
    db.ts polls.ts types.ts client.ts ids.ts
scripts/
  smoke-test.mjs              全流程自测（52项，需先启动系统）
  ocr-test.cjs                OCR 数据验证脚本
silent.vbs                    后台运行辅助
```

## 自测

```bash
# 先启动系统，然后：
node scripts/smoke-test.mjs
```
（82 项测试）
