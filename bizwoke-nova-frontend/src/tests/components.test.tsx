import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

describe('UI Component Library', () => {
  it('renders Button with variants and handles click events', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick} variant="primary">Confirm Booking</Button>);

    const button = screen.getByRole('button', { name: /confirm booking/i });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('renders Badge with correct status variants', () => {
    const { rerender } = render(<Badge variant="success">Confirmed</Badge>);
    expect(screen.getByText('Confirmed')).toBeInTheDocument();

    rerender(<Badge variant="destructive">Cancelled</Badge>);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('renders Input with label, placeholder, and helper text', () => {
    render(
      <Input
        label="Customer Email"
        placeholder="john@example.com"
        helperText="We will send appointment updates here."
      />
    );

    expect(screen.getByText('Customer Email')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('john@example.com')).toBeInTheDocument();
    expect(screen.getByText('We will send appointment updates here.')).toBeInTheDocument();
  });

  it('renders Card with nested title and content', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Appointments Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Total Bookings: 42</p>
        </CardContent>
      </Card>
    );

    expect(screen.getByText('Appointments Summary')).toBeInTheDocument();
    expect(screen.getByText('Total Bookings: 42')).toBeInTheDocument();
  });
});
