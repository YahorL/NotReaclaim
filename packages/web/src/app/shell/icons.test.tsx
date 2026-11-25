import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Icons, type IconName } from './icons';

const NAMES = Object.keys(Icons) as IconName[];

describe('Icons', () => {
  it('includes the redesign glyphs', () => {
    for (const name of ['habits', 'buffers', 'hours', 'sun', 'moon', 'lock', 'pin', 'refresh', 'warning', 'play', 'stop', 'user', 'grip', 'chevLeft', 'chevRight']) {
      expect(NAMES).toContain(name);
    }
  });

  it.each(NAMES)('%s renders a decorative svg at the requested size', (name) => {
    const Icon = Icons[name];
    const { container } = render(<Icon size={20} className="x" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('class', 'x');
    expect(svg.childElementCount).toBeGreaterThan(0);
  });
});
