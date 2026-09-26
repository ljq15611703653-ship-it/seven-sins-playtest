# 七罪暗队 · Sin Squad

德州扑克的下注 × 酒馆战棋的自动战斗。每手从牌池排出 3 名人物、只亮 1 名，靠下注讲故事，揭开后自动开打。

**在线试玩：** https://h4s2o8.github.io/seven-sins-playtest/ （`main` 每次更新后自动构建发布）

## 目录

| 目录 | 内容 |
| --- | --- |
| [`sin-squad-core/`](sin-squad-core/) | 游戏本体：规则核心（TypeScript）、电脑对手、模拟器，以及 `web/` 下的网页界面、立绘和背景音乐 |
| [`sin-squad-source/`](sin-squad-source/) | 早期 Godot 版本源码和完整设计稿 |

## 本地运行

```sh
cd sin-squad-core
npm install
npm test
npm run build:web      # 打包到仓库根目录的 sin-squad-v3/（不进 git）
python3 -m http.server --directory ../sin-squad-v3
```

## 分支约定

- `main` 是唯一主线，永远保持可玩。
- 新功能从最新的 `main` 开短分支，做完合回 `main` 后删除分支。
- 打包产物 `sin-squad-v3/` 不提交，由 GitHub Actions 在 `main` 上构建并发布到 GitHub Pages。

## 早期原型

无欲之所第一幕试玩、Four Desires、Oath Fall、卡牌对决、面具牌桌，以及 Godot 版七罪暗队的网页导出，已从 `main` 移除，完整保留在 tag [`prototypes-archive-2026-09`](../../tree/prototypes-archive-2026-09)。
