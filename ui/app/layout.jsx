import './globals.css';

export const metadata = {
  title: 'Ewokbot Invocation Control',
  description: 'Local workspace-bound Ewokbot invocation control UI'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
