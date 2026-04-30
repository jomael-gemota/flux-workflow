import { useQuery } from '@tanstack/react-query';
import {
  listBasecampProjects,
  listBasecampTodolists,
  listBasecampTodos,
  listBasecampTodoGroups,
  listBasecampPeople,
  listBasecampCompanies,
} from '../api/client';

export function useBasecampProjects(credentialId: string) {
  return useQuery({
    queryKey:  ['basecamp-projects', credentialId],
    queryFn:   () => listBasecampProjects(credentialId),
    enabled:   !!credentialId,
    staleTime: 5 * 60 * 1000,
    retry:     false,
  });
}

export function useBasecampTodolists(credentialId: string, projectId: string) {
  return useQuery({
    queryKey:  ['basecamp-todolists', credentialId, projectId],
    queryFn:   () => listBasecampTodolists(credentialId, projectId),
    enabled:   !!credentialId && !!projectId,
    staleTime: 5 * 60 * 1000,
    retry:     false,
  });
}

export function useBasecampTodos(credentialId: string, todolistId: string, status: 'active' | 'completed' | 'all' = 'active') {
  return useQuery({
    queryKey:  ['basecamp-todos', credentialId, todolistId, status],
    queryFn:   () => listBasecampTodos(credentialId, todolistId, status),
    enabled:   !!credentialId && !!todolistId,
    staleTime: 15_000,
    retry:     false,
  });
}

export function useBasecampTodoGroups(credentialId: string, todolistId: string) {
  return useQuery({
    queryKey:  ['basecamp-todogroups', credentialId, todolistId],
    queryFn:   () => listBasecampTodoGroups(credentialId, todolistId),
    enabled:   !!credentialId && !!todolistId,
    staleTime: 5 * 60 * 1000,
    retry:     false,
  });
}

export function useBasecampPeople(credentialId: string, projectId?: string) {
  return useQuery({
    queryKey:  ['basecamp-people', credentialId, projectId ?? ''],
    queryFn:   () => listBasecampPeople(credentialId, projectId),
    enabled:   !!credentialId,
    staleTime: 5 * 60 * 1000,
    retry:     false,
  });
}

export function useBasecampCompanies(credentialId: string) {
  return useQuery({
    queryKey:  ['basecamp-companies', credentialId],
    queryFn:   () => listBasecampCompanies(credentialId),
    enabled:   !!credentialId,
    staleTime: 5 * 60 * 1000,
    retry:     false,
  });
}
