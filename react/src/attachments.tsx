import { useEffect, useState } from 'react';
import { CloseIcon, FileIcon } from './icons.js';
import { format } from './texts.js';
import type { AttachmentRules, ChatAttachment, ThreadliveTexts } from './types.js';

/** 240 KB, 1.4 MB. */
export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
}

function accepted(file: File, accept: string[]): boolean {
  const extension = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;

  return accept.some((rule) => rule.toLowerCase() === file.type.toLowerCase() || rule.toLowerCase() === extension);
}

/**
 * The files that may go with a message, and why the others may not — the
 * server says the same, but saying it before the upload saves the wait.
 */
export function checkFiles(
  current: File[],
  incoming: File[],
  rules: AttachmentRules,
  texts: ThreadliveTexts,
): { files: File[]; errors: string[] } {
  const files = [...current];
  const errors: string[] = [];
  const maxMb = Math.round((rules.max_kb / 1024) * 10) / 10;

  for (const file of incoming) {
    if (!accepted(file, rules.accept)) {
      errors.push(format(texts.fileType, { name: file.name }));
    } else if (file.size > rules.max_kb * 1024) {
      errors.push(format(texts.fileTooBig, { name: file.name, max: maxMb }));
    } else if (files.length >= rules.max_files) {
      errors.push(format(texts.tooManyFiles, { max: rules.max_files }));
      break;
    } else {
      files.push(file);
    }
  }

  return { files, errors };
}

/** A browser link to a local file, released when no longer shown. */
function useObjectUrl(file: File | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file || typeof URL.createObjectURL !== 'function') {
      setUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return url;
}

/** One file chosen in the composer, not sent yet. */
export function DraftFile({ file, texts, onRemove }: { file: File; texts: ThreadliveTexts; onRemove: () => void }) {
  const url = useObjectUrl(file.type.startsWith('image/') ? file : undefined);

  return (
    <div className="tl-draft-file">
      {url ? (
        <img className="tl-draft-thumb" src={url} alt="" />
      ) : (
        <span className="tl-draft-icon">
          <FileIcon />
        </span>
      )}
      <span className="tl-draft-name">{file.name}</span>
      <button
        type="button"
        className="tl-draft-remove"
        aria-label={format(texts.removeFile, { name: file.name })}
        onClick={onRemove}
      >
        <CloseIcon size={12} />
      </button>
    </div>
  );
}

type Shown = { key: string; name: string; size: number; image: boolean; url: string | null; file?: File };

function ShownFile({ item }: { item: Shown }) {
  const local = useObjectUrl(item.file);
  const url = item.url ?? local;

  if (item.image && url) {
    return (
      <a className="tl-file-image" href={url} target="_blank" rel="noopener noreferrer">
        <img src={url} alt={item.name} loading="lazy" />
      </a>
    );
  }

  const content = (
    <>
      <span className="tl-file-icon">
        <FileIcon />
      </span>
      <span className="tl-file-text">
        <span className="tl-file-name">{item.name}</span>
        <span className="tl-file-size">{formatSize(item.size)}</span>
      </span>
    </>
  );

  return url ? (
    <a className="tl-file" href={url} target="_blank" rel="noopener noreferrer" download={item.file ? item.name : undefined}>
      {content}
    </a>
  ) : (
    <span className="tl-file">{content}</span>
  );
}

/** The files of a message: from the server (links) or, while sending, from the browser. */
export function MessageFiles({ attachments, files }: { attachments?: ChatAttachment[]; files?: File[] }) {
  const items: Shown[] = attachments?.length
    ? attachments.map((a) => ({ key: a.id, name: a.name, size: a.size, image: a.kind === 'image', url: a.url }))
    : (files ?? []).map((f, i) => ({
        key: `${f.name}-${i}`,
        name: f.name,
        size: f.size,
        image: f.type.startsWith('image/'),
        url: null,
        file: f,
      }));

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="tl-files">
      {items.map((item) => (
        <ShownFile key={item.key} item={item} />
      ))}
    </div>
  );
}
