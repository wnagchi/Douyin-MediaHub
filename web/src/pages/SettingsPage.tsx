import React from 'react';
import { message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { fetchScanSchedule, saveScanSchedule, fetchScanLogs, type ScanSchedule, type ScanLogItem } from '../api';

export default function SettingsPage() {
  const navigate = useNavigate();
  const [schedule, setSchedule] = React.useState<ScanSchedule | null>(null);
  const [scheduleDraft, setScheduleDraft] = React.useState<ScanSchedule | null>(null);
  const [logs, setLogs] = React.useState<ScanLogItem[]>([]);
  const [scheduleLoading, setScheduleLoading] = React.useState(false);
  const [logsLoading, setLogsLoading] = React.useState(false);

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
          <div className="settingsTitle">设置</div>
          <div className="settingsSubtitle">自动更新与更新记录</div>
        </div>
        <div className="settingsActions">
          <button className="btn ghost" onClick={() => navigate('/')}>返回</button>
        </div>
      </div>

      <div className="settingsGrid">
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
