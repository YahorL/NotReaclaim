import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { UnscheduledCard, type UnscheduledCardProps } from './UnscheduledCard';
import type { UnscheduledEntry } from './unscheduledSummary';

const entry = (key: string, title: string, detail: string): UnscheduledEntry => ({ key, title, detail, label: `${title} (${detail})` });
const five = [entry('a', 'A', '1h left'), entry('b', 'B', '1h left'), entry('c', 'C', '1h left'), entry('d', 'D', '1h left'), entry('e', 'E', '2 missed')];

function renderCard(over: Partial<UnscheduledCardProps> = {}) {
  const props: UnscheduledCardProps = { entries: five, onReplan: vi.fn(), replanPending: false, ...over };
  render(<UnscheduledCard {...props} />);
  return props;
}

describe('UnscheduledCard', () => {
  it('is a status region showing the count and the first three entries as chips', () => {
    renderCard();
    const card = screen.getByRole('status');
    expect(card).toHaveAttribute('data-testid', 'unscheduled-warning');
    expect(within(card).getByTestId('unscheduled-count')).toHaveTextContent('5');
    expect(card).toHaveTextContent("Couldn't schedule everything");
    const chips = screen.getAllByTestId('unscheduled-chip');
    expect(chips.map((c) => c.textContent)).toEqual(['A1h left', 'B1h left', 'C1h left']);
    expect(screen.getByTestId('unscheduled-more')).toHaveTextContent('+2 more');
    expect(screen.getByTestId('unscheduled-more')).toHaveAttribute('title', 'D (1h left), E (2 missed)');
  });

  it('renders title and detail as separate parts of a chip', () => {
    renderCard({ entries: [entry('task:t1', 'Tax filing', '1h left')] });
    const chip = screen.getByTestId('unscheduled-chip');
    expect(within(chip).getByText('Tax filing')).toBeInTheDocument();
    expect(within(chip).getByText('1h left')).toBeInTheDocument();
    expect(screen.queryByTestId('unscheduled-more')).toBeNull();
  });

  it('zero state: count 0, "Everything fits", no chips — but Re-plan stays', () => {
    renderCard({ entries: [] });
    expect(screen.getByTestId('unscheduled-count')).toHaveTextContent('0');
    expect(screen.getByRole('status')).toHaveTextContent(/Everything fits/);
    expect(screen.queryByTestId('unscheduled-chip')).toBeNull();
    expect(screen.getByTestId('replan-button')).toBeInTheDocument();
  });

  it('+N more calls onShowAll when given', () => {
    const onShowAll = vi.fn();
    renderCard({ onShowAll });
    fireEvent.click(screen.getByTestId('unscheduled-more'));
    expect(onShowAll).toHaveBeenCalledTimes(1);
  });

  it('+N more unfolds the whole list in place without onShowAll', () => {
    renderCard();
    fireEvent.click(screen.getByTestId('unscheduled-more'));
    expect(screen.getAllByTestId('unscheduled-chip')).toHaveLength(5);
    expect(screen.queryByTestId('unscheduled-more')).toBeNull();
  });

  it('+N more is a real button (a title tooltip is unreachable on touch)', () => {
    renderCard({ compact: true });
    expect(screen.getByTestId('unscheduled-more').tagName).toBe('BUTTON');
  });

  it('compact shows a single chip', () => {
    renderCard({ compact: true });
    expect(screen.getAllByTestId('unscheduled-chip')).toHaveLength(1);
    expect(screen.getByTestId('unscheduled-more')).toHaveTextContent('+4 more');
  });

  it('Re-plan calls onReplan', () => {
    const { onReplan } = renderCard();
    fireEvent.click(screen.getByTestId('replan-button'));
    expect(onReplan).toHaveBeenCalledTimes(1);
  });

  it('while re-planning the button is disabled and says so', () => {
    renderCard({ replanPending: true });
    const btn = screen.getByTestId('replan-button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent('Re-planning…');
  });

  it('keeps the Re-plan button from being squeezed (layout guarantee)', () => {
    renderCard();
    expect(screen.getByTestId('replan-button').className).toContain('shrink-0');
    expect(screen.getByTestId('replan-button').className).toContain('whitespace-nowrap');
  });
});
