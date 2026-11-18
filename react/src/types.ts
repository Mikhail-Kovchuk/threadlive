export interface ThreadliveProps {
  /**
   * Where the Laravel package's routes are: your API origin plus the route
   * prefix, e.g. `https://api.example.com/threadlive`.
   */
  apiUrl: string;
  /** Overrides of the theme's CSS variables. */
  theme?: ThreadliveTheme;
  /** Renders nothing while true, e.g. on pages where the chat does not belong. */
  hidden?: boolean;
}

/**
 * Each value becomes a CSS variable on the widget's root element. Anything
 * left out keeps the default from `threadlive-react/styles.css`.
 */
export interface ThreadliveTheme {
  /** `--tl-accent`: buttons, the launcher, the visitor's messages. */
  accent?: string;
  /** `--tl-header-bg`: the panel's header. */
  headerBg?: string;
  /**
   * `--tl-font`. The widget loads no fonts of its own; pass the page's, e.g.
   * `var(--font-geist)` with `next/font`.
   */
  fontFamily?: string;
  /** `--tl-radius`: the panel's corners, e.g. `16px`. */
  radius?: string;
}
