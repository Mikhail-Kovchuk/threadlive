// @vitest-environment node
//
// No window, no document, no localStorage: what a Next.js server has.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Threadlive } from '../src/index.js';

describe('Threadlive on the server', () => {
  it('renders nothing, so hydration has nothing to mismatch', () => {
    expect(renderToString(<Threadlive apiUrl="/threadlive" theme={{ accent: '#ff0000' }} />)).toBe('');
  });
});
