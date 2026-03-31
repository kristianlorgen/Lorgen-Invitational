import { fail, ok } from '@/lib/apiResponse';
import { requireAdmin } from '@/lib/requireAdmin';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(request: Request) {
  try {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    const formData = await request.formData();
    const file = formData.get('photo');
    if (!(file instanceof File)) return fail('Ingen fil lastet opp', 400);

    const extension = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
    const filePath = `coin-back/back-${Date.now()}-${Math.round(Math.random() * 1e6)}.${extension}`;
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    const upload = await supabaseAdmin.storage
      .from('tournament-gallery')
      .upload(filePath, fileBuffer, {
        contentType: file.type || 'application/octet-stream',
        upsert: true
      });

    if (upload.error) return fail('Failed to upload coin back image', 500, upload.error.message);

    const { data: publicUrlData } = supabaseAdmin.storage.from('tournament-gallery').getPublicUrl(filePath);
    const photoPath = publicUrlData.publicUrl;

    const { data: activeRow } = await supabaseAdmin
      .from('coin_back_images')
      .select('focal_point')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const focalPoint = activeRow?.focal_point || '50% 50%';

    const deactivate = await supabaseAdmin.from('coin_back_images').update({ is_active: false }).eq('is_active', true);
    if (deactivate.error) return fail('Failed to update coin back status', 500, deactivate.error.message);

    const { data, error } = await supabaseAdmin
      .from('coin_back_images')
      .insert({ photo_path: photoPath, focal_point: focalPoint, is_active: true })
      .select('*')
      .single();

    if (error) return fail('Failed to save coin back image', 500, error.message);

    return ok({
      success: true,
      photo_path: data.photo_path,
      focal_point: data.focal_point ?? '50% 50%'
    });
  } catch (error) {
    return fail('Unexpected server error', 500, error);
  }
}
