import type { ScanProgress } from '../api';

interface ScanProgressModalProps {
  loading: boolean;
  progress: ScanProgress | null;
}

export default function ScanProgressModal({ loading, progress }: ScanProgressModalProps) {
  if (!loading || !progress) return null;

  return (
    <div className="scanProgressOverlay">
      <div className="scanProgressModal">
        <div className="scanProgressHeader">
          <h3>正在扫描资源</h3>
          <div className="scanProgressPhase">
            {progress.phase === 'init' && '初始化...'}
            {progress.phase === 'scanning' && '扫描目录中...'}
            {progress.phase === 'processing' && '处理文件中...'}
          </div>
        </div>

        <div className="scanProgressBody">
          <div className="scanProgressStats">
            <div className="scanProgressStat">
              <span className="scanProgressStatLabel">目录进度</span>
              <span className="scanProgressStatValue">
                {progress.currentDir} / {progress.totalDirs}
              </span>
            </div>
            <div className="scanProgressStat">
              <span className="scanProgressStatLabel">已扫描文件</span>
              <span className="scanProgressStatValue">{progress.scannedFiles}</span>
            </div>
            <div className="scanProgressStat">
              <span className="scanProgressStatLabel">新增</span>
              <span className="scanProgressStatValue success">{progress.added}</span>
            </div>
            <div className="scanProgressStat">
              <span className="scanProgressStatLabel">更新</span>
              <span className="scanProgressStatValue warning">{progress.updated}</span>
            </div>
            <div className="scanProgressStat">
              <span className="scanProgressStatLabel">删除</span>
              <span className="scanProgressStatValue error">{progress.deleted}</span>
            </div>
          </div>

          {progress.currentDirPath && (
            <div className="scanProgressPath">
              <span className="scanProgressPathLabel">当前目录：</span>
              <span className="scanProgressPathValue">{progress.currentDirPath}</span>
            </div>
          )}

          <div className="scanProgressBar">
            <div
              className="scanProgressBarFill"
              style={{
                width: `${progress.totalDirs > 0 ? (progress.currentDir / progress.totalDirs) * 100 : 0}%`,
              }}
            ></div>
          </div>
        </div>
      </div>
    </div>
  );
}
