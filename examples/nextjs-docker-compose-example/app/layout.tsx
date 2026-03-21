export const metadata = {
  title: "Next.js Docker Compose Example for DaoFlow",
  description: "Sample Next.js app deployed with DaoFlow using Docker Compose local build context"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
