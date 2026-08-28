import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { installMatchMedia } from '../../test/matchMedia';
import { UnscheduledWarning } from './UnscheduledWarning';

const entry = (key: string, label: string) => ({ key, label });
const five = [entry('a', 'A (1h left)'), entry('b', 'B (1h left)'), entry('c', 'C (1h left)'), entry('d', 'D (1h left)'), entry('e', 'E (2 missed)')];

describe('UnscheduledWarning', () => {
  it('renders nothing when everything fits', () => {
    const { container } = render(<UnscheduledWarning entries={[]} />);
    expect(screen.queryByTestId('unscheduled-warning')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the entries in an amber banner', () => {
    render(<UnscheduledWarning entries={[entry('task:t1', 'Tax filing (1h left)'), entry('habit:h1', 'Run (2 missed)')]} />);
    const banner = screen.getByTestId('unscheduled-warning');
    expect(banner).toHaveTextContent("Couldn't schedule everything:");
    expect(banner.className).toContain('amber');
    expect(screen.getByText('Tax filing (1h left)')).toBeInTheDocument();
    expect(screen.getByText('Run (2 missed)')).toBeInTheDocument();
  });

  it('shows at most three entries and folds the rest into +N more', () => {
    render(
      <UnscheduledWarning
        entries={[
          entry('a', 'A (1h left)'), entry('b', 'B (1h left)'), entry('c', 'C (1h left)'),
          entry('d', 'D (1h left)'), entry('e', 'E (2 missed)'),
        ]}
      />,
    );
    expect(screen.getByText('C (1h left)')).toBeInTheDocument();
    expect(screen.queryByText('D (1h left)')).toBeNull();
    const more = screen.getByText('+2 more');
    expect(more).toHaveAttribute('title', 'D (1h left), E (2 missed)');
  });

  it('still shows three entries and a +2 on a desktop banner', () => {
    render(<UnscheduledWarning entries={five} />);
    expect(screen.getByText('C (1h left)')).toBeInTheDocument();
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });

  it('shows a single entry below md — the banner measured 101px over four lines at 390px', () => {
    const mm = installMatchMedia({ '(max-width: 767.98px)': true });
    render(<UnscheduledWarning entries={five} />);
    expect(screen.getByText('A (1h left)')).toBeInTheDocument();
    expect(screen.queryByText('B (1h left)')).toBeNull();
    expect(screen.getByText('+4 more')).toBeInTheDocument();
    mm.restore();
  });

  it('+N more is a button that unfolds the whole list', () => {
    render(<UnscheduledWarning entries={five} />);
    fireEvent.click(screen.getByTestId('unscheduled-more'));
    for (const e of five) expect(screen.getByText(e.label)).toBeInTheDocument();
    expect(screen.queryByTestId('unscheduled-more')).toBeNull();
  });

  it('unfolds on a phone too, where a title tooltip is unreachable', () => {
    const mm = installMatchMedia({ '(max-width: 767.98px)': true });
    render(<UnscheduledWarning entries={five} />);
    const more = screen.getByTestId('unscheduled-more');
    expect(more.tagName).toBe('BUTTON');
    fireEvent.click(more);
    for (const e of five) expect(screen.getByText(e.label)).toBeInTheDocument();
    mm.restore();
  });
});
