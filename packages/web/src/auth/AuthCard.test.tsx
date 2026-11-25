import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AuthCard, AuthField } from './AuthCard';

describe('AuthCard', () => {
  it('renders a page-level heading and its content', () => {
    render(<AuthCard title="NotReclaim" subtitle="Your calendar, auto-scheduled."><p>body</p></AuthCard>);
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'NotReclaim' })).toBeInTheDocument();
    expect(screen.getByText('Your calendar, auto-scheduled.')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });
});

describe('AuthField', () => {
  it('is a labelled input that reports its value and passes input attributes through', () => {
    const onChange = vi.fn();
    render(<AuthField id="pw" label="Password" type="password" value="" onChange={onChange} minLength={10} required />);
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('minlength', '10');
    expect(input).toBeRequired();
    fireEvent.change(input, { target: { value: 'secret' } });
    expect(onChange).toHaveBeenCalledWith('secret');
  });
});
