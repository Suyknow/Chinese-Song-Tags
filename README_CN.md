> 🌐 [English](README.md) | **中文**

# Chinese-Song-Tags

给你的 Apple Music 曲库打上 **"Chinese Songs"** 标记，让**智能播放列表**自动
收集所有中文歌曲——即使它们的曲风是 `Pop`、`Blues`、`Rock`，元数据里也没有任何
"Chinese" 字样。

## 为什么需要它

Apple Music 的**智能播放列表没有正则、也没有语言字段**，无法用规则判断
"标题/歌手/专辑里含中文字符"。唯一可行的思路是：

1. 先按元数据里的字符把歌曲分类；
2. 给命中的歌曲写一个普通标签（`Grouping` 分组字段）；
3. 让智能播放列表按这个标签筛选，并保持自动更新。

本项目把第 1、2 步自动化，并对**新增歌曲**持续生效。

## 适用范围

- **仅 macOS**（使用系统自带的 `osascript` + `launchd`，无需安装任何包）。
- 作用于**本地 Apple Music / 音乐 App 曲库**；仅在线播放、未加入曲库的歌曲不处理。
- 适合这些场景：
  - 从混合曲库里分出**普通话 / 粤语 / 其他中文**歌曲；
  - 曲风被标成 `Pop`、`Blues` 等通用类别的中文歌；
  - 只要**简体中文**（默认排除繁体、日文假名、韩文和日文专用汉字）。
- 检测字段（`title`、`artist`、`album`）和写入的标签值都可配置，见[选项](#选项)。

## 工作原理

```
音乐曲库 ──► tag_chinese_music.js ──► 写入 Grouping = "Chinese Songs"
                     ▲
     launchd 代理（run-tagger.sh）监听曲库，给新歌打标
                     ▲
     智能播放列表： 分组 包含 "Chinese Songs"（勾选实时更新）
```

- **识别规则**：任一被检查字段含汉字，且所有被检查字段都不含日文假名、韩文、
  繁体字、日文专用汉字（新字体/国字）时才打标。繁体字用系统内置的
  `Traditional-Simplified` 文本转换识别，不依赖任何外部数据。
- **增量**：状态文件记住已分类歌曲的 `persistentID`，之后每次只看**最近 `since`
  天新增**的歌曲（默认 30 天）。新加一首中文歌几秒内即可打标，无需全库重扫。
  窗口内的歌曲每次运行都会重新判定，因此刚加入时（云端）元数据尚未加载完的歌，
  加载完成后仍会被补标。
- **幂等**：同一标签只追加一次；重复运行不产生变化。

## 环境要求

- macOS，且装有**音乐（Music）**App。
- 本地曲库（默认 `~/Music/Music/Music Library.musiclibrary`）。
- 无需其他依赖，不安装任何 Python/npm/Homebrew 包。

## 安装

```sh
git clone https://github.com/Suyknow/Chinese-Song-Tags.git
cd Chinese-Song-Tags
./install.sh
```

`install.sh` 会把脚本复制到 `~/.local/share/chinesesongs`，生成 LaunchAgent
`~/Library/LaunchAgents/local.chinesesongs.plist` 并加载。代理会立即运行一次，
之后在曲库变化时自动运行。

然后在**音乐**里：`文件 ▸ 新建 ▸ 智能播放列表`，规则设为

```
分组   包含   Chinese Songs
```

并勾选**实时更新**。

> 代理首次运行会做一次**全库扫描**，为已有歌曲分类；之后只检查新增歌曲。

## 手动使用

预览、一次性扫描或改规则后重建时，可直接运行：

```sh
osascript -l JavaScript tag_chinese_music.js preview       # 只读预览
osascript -l JavaScript tag_chinese_music.js apply         # 全库扫描并打标
osascript -l JavaScript tag_chinese_music.js incremental   # 只处理新歌
```

### 模式

| 模式 | 作用 |
|---|---|
| `preview` | 列出命中的歌曲，不做任何修改。 |
| `apply` | 全库扫描并给所有命中歌曲打标（幂等）。 |
| `incremental` | 只分类未处理过的歌曲。首次为全库 pass，之后只检查最近 `since` 天新增的歌。代理即用此模式。 |

### 选项

选项以 `key=value` 追加。

| 选项 | 默认 | 含义 |
|---|---|---|
| `field=grouping\|comment` | `grouping` | 写入哪个元数据字段。 |
| `tag=TEXT` | `Chinese Songs` | 写入的标签值。 |
| `title=0\|1` | `1` | 检查标题。 |
| `artist=0\|1` | `1` | 检查歌手。 |
| `album=0\|1` | `1` | 检查专辑。 |
| `kana=keep\|exclude` | `exclude` | 排除含日文假名的歌曲。 |
| `trad=keep\|exclude` | `exclude` | 排除含繁体字的歌曲。 |
| `hangul=keep\|exclude` | `exclude` | 排除含韩文的歌曲。 |
| `jp=keep\|exclude` | `exclude` | 排除含日文专用汉字的歌曲。 |
| `clear=1` | 关 | 移除标签而非添加（仅 `apply`）。 |
| `limit=N` | 关 | 限制处理数量（测试用）。 |
| `since=N` | `30` | `incremental`：只看最近 N 天新增的歌曲。 |
| `state=/path.json` | `~/.local/state/chinesesongs/seen_ids.json` | `incremental` 的状态文件。 |
| `dry=1` | 关 | `incremental`：只报告，不写入。 |

示例：

```sh
# 预览会被打标的歌曲，不写入
osascript -l JavaScript tag_chinese_music.js preview

# 写入「注释」字段而非「分组」
osascript -l JavaScript tag_chinese_music.js apply field=comment

# 允许日文假名（凡含汉字都打标）
osascript -l JavaScript tag_chinese_music.js apply kana=keep

# 移除所有标签
osascript -l JavaScript tag_chinese_music.js apply clear=1
```

### wrapper 配置（环境变量）

launchd wrapper `run-tagger.sh` 读取以下可选变量：

| 变量 | 默认 |
|---|---|
| `CHINESESONGS_TAG` | `Chinese Songs` |
| `CHINESESONGS_STATE` | `~/.local/state/chinesesongs/seen_ids.json` |
| `CHINESESONGS_LOG` | `~/.local/state/chinesesongs/tagger.log` |

### 改规则后重建

修改任一选项（如 `kana`、`album`）会让 `incremental` 做一次全库 pass，但**不再命中
的旧标签不会自动移除**。彻底重建：

```sh
osascript -l JavaScript tag_chinese_music.js apply clear=1   # 清空全部标签
rm -f ~/.local/state/chinesesongs/seen_ids.json               # 重置状态
osascript -l JavaScript tag_chinese_music.js incremental      # 全量重打
```

## 日志

代理每次运行会向 `~/.local/state/chinesesongs/tagger.log` 追加一个带时间戳的块，
并在每次运行时删除超过 30 天的块。每块末尾为
`# exit=… status=ok|failures|error`。

## 卸载

```sh
./uninstall.sh          # 移除代理，保留状态/日志
./uninstall.sh --purge  # 一并删除状态与日志
```

只想从曲库移除标签：

```sh
osascript -l JavaScript tag_chinese_music.js apply clear=1
```

## 局限

- **语言识别是启发式的**，靠字符而非真正的语言字段：
  - 若某日文歌的被检查字段只含中日共用、非繁体的汉字且无假名（如 `大阪`、`京都`），
    仍可能被打标。可把相应字符加入 `tag_chinese_music.js` 里的 `JP_ONLY`，或用
    `jp=`/`kana=`。
  - 默认排除繁体与日文；把 `trad=`/`kana=`/`jp=` 设为 `keep` 可纳入。
  - `JP_ONLY` 汉字表为人工维护，并非穷举。
- `clear=1` 以子串方式移除标签；若你的 `Grouping` 里恰好把该标签嵌在更长的词中间，
  会被改写。
- 在 `since` 窗口内的歌曲每次运行都会重新判定，所以手动移除**最近新增**歌曲的标签后，
  后续运行可能会再次补上。
- 只处理本地曲库；纯在线流媒体条目会被忽略。

## 文件

| 文件 | 用途 |
|---|---|
| `tag_chinese_music.js` | 打标主程序（JXA），包含全部识别逻辑。 |
| `run-tagger.sh` | launchd wrapper：加锁、日志轮转、状态上报。 |
| `install.sh` | 安装脚本并生成、加载 LaunchAgent。 |
| `uninstall.sh` | 移除 LaunchAgent（可选清理状态/日志）。 |
| `README.md` / `README_CN.md` | 说明文档（英文 / 中文）。 |

## 许可证

本项目采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)
（署名-非商用-相同方式共享）协议。详见 [LICENSE](LICENSE)。
