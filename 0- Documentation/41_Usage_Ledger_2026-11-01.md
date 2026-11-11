# 41 — Usage ledger for Claude and Codex (November 1, 2026)

> **November 11, 2026:** pacing changed by [record 44](44_Leftover_Quota_and_Full_Throttle_Run_2026-11-11.md). Since November 4, 0.7 runs on end-of-week leftovers, and the 90% weekly limits lift on the last day of a week. For the November 11 run, Claude works up to 95% of its 5-hour and weekly windows; Codex keeps 80%/90%.

**Status:** active. Owner: Ahmed. Writer: Claude (root). This record owns the method, the ceilings and the first findings. The live page is a view of the same data.

## Owner request and decision

Ahmed, November 1, ~03:00 Cairo, verbatim:
> "I suggest doing a dedicated artifact that's with the theme of our FFmpeg encoder project style as well, for registering and documenting and graphing the cost of our work in terms of hourly quota per tasks, possibly, if tokens, if possible, as well as what Codex is also burning across GPT-6.1 sol extra high within the dedicated task. I don't know how to measure that, but at least each run, perhaps, each task, so we can document and get a gut feeling of, or educated gut feeling, technically, of our consumption, especially for Codex"

Ahmed, November 1, ~03:15 Cairo, verbatim:
> "Okay, shift the upper limit of the weekly limit to be 90%, not 80%."

**Decision 1 — working ceilings.**

| Who | 5-hour window | Weekly window | Source |
|---|---|---|---|
| Claude (Pro) | 80% before starting a review workflow | **90%** | Nov 1 decision above; 5-hour from the C2 precedent in record 10 |
| Codex (ChatGPT Plus) | 80% before starting a job | 90% | record 40, October 31 |

## Where it lives

- **Page:** [FFmpeg Encoder Usage Ledger](https://claude.ai/artifact/QzNLwoD6A5RYEcdvskFYKU). It is a private Dashboard artifact in the app's own amber (dark) and teal (light) themes. It shows the four windows, the per-unit rates, the share of each week by piece of work, the windows over time, the Codex run ledger and the Claude task ledger.
- **Tools** (local, ignored), in `artifacts/v0.7/usage/`:
  - `usage-scan.cjs` reads the Claude Code transcripts of this project and the Codex receipts and logs.
  - `build-ledger.cjs` writes the four datasets to `data/`.
  - The page source is `page/index.html`.
- **Refresh** at each phase close:

  ```bash
  node usage-scan.cjs scan-latest.json
  node build-ledger.cjs scan-latest.json data
  ```

  Run both from `artifacts/v0.7/usage/`. Then upload the four files to the page as new assets and point its datasets at them. The figures that matter go into the dated Execution Summary.

## Method

- **Claude tokens.** Every reply in the project's transcripts is counted once: the lead session, its agents, every review workflow and the hourly ticks.
  - Tokens are price-weighted: fresh input 1, cache write 1.25, cache read 0.1, output 5.
  - Lead-session work is split at each commit and named by it. Each workflow is its own task.
- **Claude percentages.** Each 5-hour window starts at 0%, so its newest reading divided by the weighted tokens since its start gives a rate. A task's share is its weighted tokens times the median 5-hour rate, and times the pooled weekly rate.
- **Codex.** The `/codex-run` receipts carry exact tokens (input, cached, output, reasoning) and the 5-hour and weekly readings before and after each run.
  - Ahmed's model-switch turn in the Codex app is entered at the 10% the app showed. The logs had not caught up.
  - The pilot's start is therefore 10%, not the 0% its lagging reading showed.
- **Limits.**
  - Both quota pools are account-wide. Use outside this project in the same hours counts against it.
  - Codex readings trail by one call, so a run's last call lands on the next run.
  - Claude task shares are estimates. Codex shares are measured.

## First findings (data to November 1, ~02:00 Cairo)

- **Claude rate.** One million weighted tokens use about **8.3%** of a 5-hour window and about **1.15%** of the week.
  - The 5-hour figure is the median of 10 windows, which ranged from 7.2 to 9.7.
  - The weekly figure pools 2 windows (1.08 and 1.18).
  - So a full week is about 87 million weighted tokens, or about seven full 5-hour windows.
- **Codex rate.** 1% of the 5-hour window buys about **15k uncached input tokens**, or about **290k tokens** counting cached ones (median of the runs).
  - Uncached input predicts cost best.
  - The model-switch turn re-read a cold 202k-token thread with only 24k cached, and cost 10% on its own.
- **Where Claude's quota went** (estimated share of a week, October 29 to November 1, over two weekly windows):

  | Piece of work | Share |
  |---|---|
  | toolkit and policy | 25.6% |
  | native runtime | 24.1% |
  | C2 | 13.2% |
  | C1 | 11.7% |
  | C3 | 10.4% |
  | Codex setup | 10.4% |
  | design (record 37) | 8.6% |
  | logo candidates | 8.4% |
  | onboarding | 7.7% |
  | ticks | 0.5% |

  The largest single items were the 27-agent native WIP review (13.4%) and the native runtime lead session (10.0%).
- **Claude alone versus Codex executing.**
  - **C2's review-and-fix round** (Claude only) cost Claude about **9.8%** of its week: the review workflow 5.6% and the fixes 4.3%.
  - **C3's equivalent round** had two Codex reviews and two Codex fix jobs. It cost Claude about **2%** for supervision, and Codex about **8% of its own week**.
  - The extra Claude review on top cost about 3.1%.
- **Context size is a cost.** Every lead step re-reads the whole conversation. At about 360k tokens of context that is about 36k weighted tokens, or about 0.04% of the week, per step. A long session gets more expensive per action.

## How to use it

- Before planning a phase, read the four windows and the per-unit rates. Send long or exploratory execution to Codex. Keep Claude for leading, review and records.
- Prefer a fresh or compacted lead context for long phases.
- Record each phase's Claude and Codex figures in its Execution Summary section.

## C4 finding (November 1, ~07:00 Cairo)

- Codex's cached input is not free. `c4-work` had 165k uncached but 18.4M cached input tokens, and it used 39 points of the 5-hour window. By the 15k-uncached rule, it would have used 11. Short jobs still fit that rule: `c4-review`, `c4-fixes` and `c4-rereview` used 9–11 points each, for 133k–141k uncached.
- The cause was the job polling its own long ledger run. The fix is a working rule, recorded in record 40, Stage 3: root runs long ledgers and the full suite.
- C4 as a whole: Codex used 69 points of its 5-hour window and 11 of its weekly window. Claude used about 2 weekly points, for briefs, diff review, four small root fixes, the evidence and these records.

## Page update (November 1, ~09:30 Cairo)

Ahmed asked for the weekly view in the charts and for a token figure for each allowance:
- **Both bar charts now have two panels**, each on its own scale: the share of the week, and the 5-hour windows used.
- **The Codex rate card** gives what 1% of the week buys, too: about 2.1M tokens (89k uncached).
- **New cards estimate each window's size**, as an educated guess from the measured rates and not a published limit:
  - Claude: about 12.2M weighted tokens per 5-hour window and 88M per week. That is about 74M and 533M raw at this project's mix.
  - Codex: about 28.8M and 207M tokens, counting cached input (1.5M and 8.9M uncached).
- **The theme is unchanged:** only the app's existing tokens, amber and teal. The page was checked live in both themes.
