import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Threadlive } from '../src/index.js';

afterEach(cleanup);

describe('Threadlive', () => {
  it('mounts on the client', () => {
    const { container } = render(<Threadlive apiUrl="/threadlive" />);

    expect(container.querySelector('.tl-root')).not.toBeNull();
  });

  it('renders nothing while hidden', () => {
    const { container } = render(<Threadlive apiUrl="/threadlive" hidden />);

    expect(container.innerHTML).toBe('');
  });

  it('turns the theme into CSS variables, leaving the rest to the stylesheet', () => {
    const { container } = render(
      <Threadlive apiUrl="/threadlive" theme={{ accent: '#ff0000', radius: '8px' }} />,
    );
    const root = container.querySelector<HTMLElement>('.tl-root');

    expect(root?.style.getPropertyValue('--tl-accent')).toBe('#ff0000');
    expect(root?.style.getPropertyValue('--tl-radius')).toBe('8px');
    expect(root?.style.getPropertyValue('--tl-header-bg')).toBe('');
  });
});
