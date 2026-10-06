import { fireEvent, render } from '@testing-library/react';
import Avatar from './Avatar';

test('shows initials when there is no photo', () => {
    const { container } = render(<Avatar name="Jane Doe" email="j@x.dev" />);
    expect(container.textContent).toBe('JD');
    expect(container.querySelector('img')).toBeNull();
});

test('shows the photo when src is set', () => {
    const { container } = render(<Avatar name="Jane Doe" src="/api/user/avatar/1?v=1" />);
    expect(container.querySelector('img').getAttribute('src')).toBe('/api/user/avatar/1?v=1');
});

test('falls back to initials if the photo fails to load', () => {
    const { container } = render(<Avatar name="Jane" src="/broken.png" />);
    fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('J');
});
