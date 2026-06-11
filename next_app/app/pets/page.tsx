import { PetsBoard } from '@/components/pets/PetsBoard';

export const metadata = {
  title: '生体管理 | Kennel Dashboard',
  description: '生体情報の管理・閲覧',
};

export default function PetsPage() {
  return (
    <div className="h-full">
      <PetsBoard />
    </div>
  );
}
