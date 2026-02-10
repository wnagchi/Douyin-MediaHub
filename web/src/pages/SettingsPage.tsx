import React from 'react';
import { message } from 'antd';
import { useNavigate } from 'react-router-dom';
import {
  fetchScanSchedule,
  saveScanSchedule,
  fetchScanLogs,
  fetchResourceStats,
  type ScanSchedule,
  type ScanLogItem,
  type ResourceTypeStat,
  type ResourceAuthorStat,
} from '../api';

export default function SettingsPage() {
  const navigate = useNavigate();
  const [schedule, setSchedule] = React.useState<ScanSchedule | null>(null);
  const [scheduleDraft, setScheduleDraft] = React.useState<ScanSchedule | null>(null);
  const [logs, setLogs] = React.useState<ScanLogItem[]>([]);
  const [scheduleLoading, setScheduleLoading] = React.useState(false);
  const [logsLoading, setLogsLoading] = React.useState(false);
  const [stats, setStats] = React.useState<{
    totals: { items: number; groups: number };
    types: ResourceTypeStat[];
    authors: ResourceAuthorStat[];
  } | null>(null);
  const [statsLoading, setStatsLoading] = React.useState(false);
  const [statsError, setStatsError] = React.useState<string | null>(null);
  const [authorLimit, setAuthorLimit] = React.useState(() => {
    try {
      const v = Number(localStorage.getItem('ui_stats_author_limit') || '20');
      return Number.isFinite(v) && v > 0 ? v : 20;
    } catch {
      return 20;
    }
  });

  React.useEffect(() => {
    setScheduleLoading(true);
    fetchScanSchedule()
      .then((r) => {
        if (r.ok && r.schedule) {
          setSchedule(r.schedule);
          setScheduleDraft(r.schedule);
        } else {
          message.error(r.error || '加载自动更新设置失败');
        }
      })
      .finally(() => setScheduleLoading(false));
  }, []);

  const loadStats = React.useCallback(() => {
    setStatsLoading(true);
    setStatsError(null);
    fetchResourceStats(authorLimit)
      .then((r) => {
        if (!r.ok) {
          if (r.code === 'NO_MEDIA_DIR') {
            setStats(null);
            setStatsError('未配置资源目录');
            return;
          }
          const msg = r.error || '加载资源统计失败';
          setStats(null);
          setStatsError(msg);
          message.error(msg);
          return;
        }
        const totals = r.totals || { items: 0, groups: 0 };
        const types = Array.isArray(r.types) ? r.types : [];
        const authors = Array.isArray(r.authors) ? r.authors : [];
        setStats({ totals, types, authors });
      })
      .catch((e) => {
        const msg = String(e instanceof Error ? e.message : e);
        setStats(null);
        setStatsError(msg);
        message.error(msg || '加载资源统计失败');
      })
      .finally(() => setStatsLoading(false));
  }, [authorLimit]);

  React.useEffect(() => {
    loadStats();
  }, [loadStats]);

  const loadLogs = React.useCallback(() => {
    setLogsLoading(true);
    fetchScanLogs(100)
      .then((r) => {
        if (r.ok && Array.isArray(r.logs)) {
          setLogs(r.logs);
        } else {
          message.error(r.error || '加载更新记录失败');
        }
      })
      .finally(() => setLogsLoading(false));
  }, []);

  React.useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  return (
    <main className="container">
      <div className="settingsHeader">
        <div>
          <div className="settingsTitle">设置1</div>
          <div className="settingsSubtitle">自动更新与更新记录</div>
        </div>
        <div className="settingsActions">
          <button className="btn ghost" onClick={() => navigate('/')}>返回</button>
        </div>
      </div>

      <div className="settingsGrid">
        <section className="card settingsCard">
          <div className="cardInner">
            <div className="settingsCardHeader">
              <div className="settingsCardTitle">资源统计</div>
              <div className="statsHeaderActions">
                <select
                  className="statsLimitSelect"
                  value={authorLimit}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (!Number.isFinite(next) || next <= 0) return;
                    setAuthorLimit(next);
                    try {
                      localStorage.setItem('ui_stats_author_limit', String(next));
                    } catch {}
                  }}
                  title="发布者统计条数"
                >
                  {[10, 20, 30, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      TOP {n}
                    </option>
                  ))}
                </select>
                <button className="btn ghost compact" onClick={loadStats} disabled={statsLoading}>
                  刷新
                </button>
              </div>
            </div>
            {statsLoading && <div className="settingsMuted">加载中…</div>}
            {!statsLoading && statsError && <div className="statsError">{statsError}</div>}
            {!statsLoading && !statsError && !stats && <div className="settingsMuted">暂无数据</div>}
            {!statsLoading && !statsError && stats && (
              <>
                <div className="statsHero">
                  <div>
                    <div className="statsValue">{stats.totals.items}</div>
                    <div className="statsLabel">资源总数</div>
                  </div>
                  <div className="statsMeta">合集 {stats.totals.groups}</div>
                </div>
                <div className="statsBreakdown">
                  {stats.types.length === 0 && <div className="settingsMuted">暂无类型数据</div>}
                  {stats.types.map((t) => (
                    <div key={t.type || 'unknown'} className="statsChip">
                      <span className="statsChipLabel">{t.type || '未知'}</span>
                      <span className="statsChipValue">{t.itemCount}</span>
                      <span className="statsChipMeta">组 {t.groupCount}</span>
                    </div>
                  ))}
                </div>

                <div className="statsSectionTitle">发布者 TOP {authorLimit}</div>
                <div className="statsAuthorList">
                  {stats.authors.length === 0 && <div className="settingsMuted">暂无发布者数据</div>}
                  {stats.authors.map((a, idx) => (
                    <div key={`${a.author}-${idx}`} className="statsAuthorRow">
                      <div className="statsAuthorName">{a.author || '未知发布者'}</div>
                      <div className="statsAuthorCounts">
                        <span className="statsAuthorCount">内容 {a.itemCount}</span>
                        <span className="statsAuthorCount">合集 {a.groupCount}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>

        <section className="card settingsCard">
          <div className="cardInner">
            <div className="settingsCardTitle">自动更新</div>
            {scheduleLoading && <div className="settingsMuted">加载中…</div>}
            {!scheduleLoading && scheduleDraft && (
              <div className="settingsForm">
                <label className="settingsRow">
                  <input
                    type="checkbox"
                    checked={scheduleDraft.enabled}
                    onChange={(e) => setScheduleDraft({ ...scheduleDraft, enabled: e.target.checked })}
                  />
                  启用自动更新
                </label>
                <div className="settingsField">
                  <label>每日时间</label>
                  <input
                    type="time"
                    value={scheduleDraft.timeOfDay}
                    onChange={(e) => setScheduleDraft({ ...scheduleDraft, timeOfDay: e.target.value })}
                  />
                </div>
                <div className="settingsField">
                  <label>间隔小时</label>
                  <select
                    value={scheduleDraft.intervalHours}
                    onChange={(e) => setScheduleDraft({ ...scheduleDraft, intervalHours: Number(e.target.value) })}
                  >
                    {[6, 12, 24, 48, 72].map((h) => (
                      <option key={h} value={h}>
                        每 {h} 小时
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settingsMeta">
                  上次更新：{schedule?.lastRunAt ? new Date(schedule.lastRunAt).toLocaleString() : '暂无'}
                  <br />
                  下次更新：{schedule?.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString() : '未启用'}
                </div>
                <div className="settingsButtons">
                  <button
                    className="btn"
                    onClick={async () => {
                      if (!scheduleDraft) return;
                      const r = await saveScanSchedule(scheduleDraft);
                      if (!r.ok) {
                        message.error(r.error || '保存失败');
                        return;
                      }
                      setSchedule(r.schedule || scheduleDraft);
                      message.success('已保存自动更新设置');
                    }}
                  >
                    保存设置
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="card settingsCard">
          <div className="cardInner">
            <div className="settingsCardTitle">更新记录</div>
            <div className="settingsListHeader">
              <div className="settingsMuted">最近 100 条</div>
              <button className="btn ghost compact" onClick={loadLogs} disabled={logsLoading}>
                刷新
              </button>
            </div>
            {logsLoading && <div className="settingsMuted">加载中…</div>}
            {!logsLoading && logs.length === 0 && <div className="settingsMuted">暂无记录</div>}
            {!logsLoading && logs.length > 0 && (
              <div className="settingsList">
                {logs.map((log) => {
                  const typeStats = log.result?.typeStats || {};
                  const addedStats = typeStats.added || {};
                  return (
                    <div key={log.id} className="settingsLogItem">
                      <div className="settingsLogTitle">
                        {new Date(log.startedAt).toLocaleString()} · {log.trigger === 'auto' ? '自动' : '手动'}
                      </div>
                      <div className="settingsLogMain">
                        新增 {log.result?.added ?? 0} · 更新 {log.result?.updated ?? 0} · 删除 {log.result?.deleted ?? 0}
                      </div>
                      <div className="settingsLogMeta">
                        视频 {addedStats.video ?? 0} · 实况 {addedStats.live ?? 0} · 图集 {addedStats.album ?? 0} · 其他 {addedStats.other ?? 0}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
