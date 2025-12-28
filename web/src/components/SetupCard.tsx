import { useState } from 'react';
import { escHtml } from '../utils';

interface SetupCardProps {
  setup: {
    needed: boolean;
    mediaDirs: string[];
    defaultMediaDirs: string[];
    fromEnv: boolean;
  };
  onSave: (mediaDirs: string[]) => Promise<void>;
}

export default function SetupCard({ setup, onSave }: SetupCardProps) {
  const [inputValue, setInputValue] = useState(
    (setup.mediaDirs || []).join('\n') || localStorage.getItem('mediaDirs') || ''
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const text = inputValue.trim();
    const lines = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!lines.length) {
      alert('请输入至少一个绝对路径（每行一个）');
      return;
    }
    setSaving(true);
    try {
      await onSave(lines);
    } finally {
      setSaving(false);
    }
  };

  const handleUseDefault = () => {
    const val = (setup.defaultMediaDirs || []).join('\n');
    if (!val) {
      alert('默认目录为空');
      return;
    }
    setInputValue(val);
  };

  const hint = setup.fromEnv
    ? '当前 mediaDir 由环境变量 MEDIA_DIR 指定（页面内无法持久化保存）。'
    : '保存后会写入项目根目录 config.json，后续启动自动生效。';

  const currentLines = inputValue.split(/\r?\n/).filter(Boolean).length;
  const defaultVal = (setup.defaultMediaDirs || []).join('\n');

  return (
    <section className="setupCard">
      <div className="setupTitle">需要配置资源目录</div>
      <div className="setupDesc">
        服务端未找到任何可用资源目录，所以暂时无法列出资源。请在下方输入<strong>绝对路径</strong>，支持多个目录（每行一个）。<br />
        {escHtml(hint)}
      </div>
      <div className="setupRow">
        <textarea
          id="mediaDirsInput"
          className="setupInput"
          rows={4}
          placeholder="例如：&#10;D:\\code\\ai\\test_http_server\\media&#10;D:\\another_media"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
        />
        <button id="saveMediaDirs" className="btn" onClick={handleSave} disabled={saving}>
          {saving ? '保存中…' : '保存并刷新'}
        </button>
        <button id="useDefaultMediaDirs" className="btn ghost" onClick={handleUseDefault}>
          使用默认
        </button>
      </div>
      <div className="setupSmall">
        current (lines): {escHtml(String(currentLines))}<br />
        default: {escHtml(defaultVal || '-')}
      </div>
    </section>
  );
}
