export const metadata = {
  title: 'Next.js + DaoFlow Example',
  description: 'Deployed with DaoFlow — the agentic platform to host deterministic systems',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
