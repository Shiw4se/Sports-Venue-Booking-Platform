import { render, screen } from '@testing-library/react';
import App from './App';

beforeEach(() => {
  localStorage.clear();
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve([
        { id: '1', name: 'Central Stadium', location: 'Kyiv', type: 'football_field' },
      ]),
    })
  );
});

test('renders navigation and venues for a guest', async () => {
  render(<App />);
  expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
  expect(await screen.findByText('Central Stadium')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Book' })).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith('/api/venue/get_all', expect.anything());
});
